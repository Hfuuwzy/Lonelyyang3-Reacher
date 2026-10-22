import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, readFile, realpath, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { IMAGE_LIMITS, PAPER_TASK_IMAGE_REASONS, paperTaskImageReceiptSchema, type PaperTaskImageBranch as PaperTaskBranch, type PaperTaskImageReason, type PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'

export type PreparedPaperTaskImage = {
  readonly assetId: string
  readonly recordId: string
  readonly revision: number
  readonly context: string
  readonly data: string
  readonly width: number
  readonly height: number
  readonly pixelDigest: string
}

type DecodedPng = { readonly width: number; readonly height: number; readonly pixelDigest: string }
type AssetMetadata = { readonly id: string; readonly recordId: string; readonly page: number; readonly bbox: readonly [number, number, number, number]; readonly availability: 'available' | 'unavailable' }
type RecordData = { readonly record: { readonly id: string; readonly kind: string; readonly state: string; readonly page: number; readonly bbox: readonly [number, number, number, number]; readonly text: string; readonly context: string }; readonly revision: number }
type CanvasImage = { readonly width: number; readonly height: number }
type CanvasContext = { drawImage(image: CanvasImage, x: number, y: number): void; getImageData(x: number, y: number, width: number, height: number): { readonly data: Uint8ClampedArray } }
type Canvas = { getContext(type: '2d'): CanvasContext }
type CanvasModule = { readonly loadImage: (input: Uint8Array) => Promise<CanvasImage>; readonly createCanvas: (width: number, height: number) => Canvas }

const ASSET_ID = /^asset-[0-9a-f]{32}$/
const RECORD_ID = /^p\d+-r\d+$/
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const metadataSchema = z.object({ id: z.string().regex(ASSET_ID), recordId: z.string().regex(RECORD_ID), page: z.number().int().positive(), bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]), availability: z.enum(['available', 'unavailable']) }).passthrough()
const recordSchema = z.object({ record: z.object({ id: z.string().regex(RECORD_ID), kind: z.string(), state: z.string(), page: z.number().int().positive(), bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]), text: z.string(), context: z.string() }).passthrough(), revision: z.number().int().positive() }).passthrough()
const indexSchema = z.array(z.string().regex(RECORD_ID))
const requireFromProject = createRequire(resolve(process.cwd(), 'package.json'))
const requireFromPdfJs = createRequire(requireFromProject.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
const canvas: CanvasModule = requireFromPdfJs('@napi-rs/canvas')

export async function decodePaperTaskPng(bytes: Uint8Array): Promise<DecodedPng> {
  if (bytes.byteLength > IMAGE_LIMITS.maxImageBytes) throw new Error('image-too-large')
  if (bytes.byteLength < 24 || !SIGNATURE.every((value, index) => bytes[index] === value)
    || Buffer.from(bytes).toString('ascii', 12, 16) !== 'IHDR') throw new Error('invalid-image')
  const header = Buffer.from(bytes)
  const width = header.readUInt32BE(16)
  const height = header.readUInt32BE(20)
  if (width === 0 || height === 0) throw new Error('invalid-image')
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension) throw new Error('image-dimension-too-large')
  if (width * height > IMAGE_LIMITS.maxPixels) throw new Error('image-too-many-pixels')
  const image = await canvas.loadImage(bytes)
  if (image.width !== width || image.height !== height) throw new Error('invalid-image')
  const decodedCanvas = canvas.createCanvas(width, height)
  const context = decodedCanvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const rgba = context.getImageData(0, 0, width, height).data
  const digest = createHash('sha256').update(`${width}x${height}:`).update(rgba).digest('hex')
  return { width, height, pixelDigest: digest }
}

function isContained(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

async function safeRead(root: string, path: string, limit: number, oversizedReason: PaperTaskImageReason = 'unreadable'): Promise<Uint8Array> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('unreadable')
  if (info.size > limit) throw new Error(oversizedReason)
  const [rootPath, filePath] = await Promise.all([realpath(root), realpath(path)])
  if (!isContained(rootPath, filePath)) throw new Error('unreadable')
  const bytes = await readFile(filePath)
  if (bytes.byteLength > limit) throw new Error(oversizedReason)
  return new Uint8Array(bytes)
}

function receipt(branch: PaperTaskBranch, assetId: string, recordId: string, revision: number, status: PaperTaskImageReceipt['status'], reason: PaperTaskImageReason | null): PaperTaskImageReceipt {
  return paperTaskImageReceiptSchema.parse({ branch, assetId, recordId, revision, status, reason })
}

function failureReason(error: unknown): PaperTaskImageReason {
  if (error instanceof Error) {
    const reason = z.enum(PAPER_TASK_IMAGE_REASONS).safeParse(error.message)
    if (reason.success) return reason.data
  }
  if (error instanceof Error && (error.message === 'invalid-image' || error.message.includes('PNG') || error.message.includes('image'))) return 'invalid-image'
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing'
  return 'unreadable'
}

export async function preparePaperTaskImages(root: string, branch: PaperTaskBranch, enabled: boolean): Promise<{ readonly images: readonly PreparedPaperTaskImage[]; readonly receipts: readonly PaperTaskImageReceipt[] }> {
  const paths = { root: resolve(root), assets: join(root, 'assets'), records: join(root, 'source-records') }
  const images: PreparedPaperTaskImage[] = []
  const receipts: PaperTaskImageReceipt[] = []
  let rawBytesTotal = 0
  let base64BytesTotal = 0
  const assetFiles = await readdir(paths.assets, { withFileTypes: true })
  const entries = assetFiles.filter((entry) => entry.name.endsWith('.json') && ASSET_ID.test(entry.name.slice(0, -5)))
  if (entries.length > 100) throw new Error('paper-task asset metadata exceeds bound')
  const indexBytes = await safeRead(paths.root, join(paths.root, 'source-index.json'), 2 * 1024 * 1024)
  const sourceIds = indexSchema.parse(JSON.parse(Buffer.from(indexBytes).toString('utf8')))
  const indexedEntries: { readonly entry: typeof entries[number]; readonly metadata?: AssetMetadata; readonly failure?: PaperTaskImageReason }[] = []
  for (const entry of entries) {
    const assetId = entry.name.slice(0, -5)
    try {
      const metadata = metadataSchema.parse(JSON.parse(Buffer.from(await safeRead(paths.root, join(paths.assets, entry.name), 2 * 1024 * 1024)).toString('utf8')))
      if (metadata.id !== assetId || !sourceIds.includes(metadata.recordId)) throw new Error('stale-source')
      indexedEntries.push({ entry, metadata })
    } catch (error) {
      indexedEntries.push({ entry, failure: failureReason(error) })
    }
  }
  indexedEntries.sort((left, right) => {
    const leftOrder = left.metadata === undefined ? Number.MAX_SAFE_INTEGER : sourceIds.indexOf(left.metadata.recordId)
    const rightOrder = right.metadata === undefined ? Number.MAX_SAFE_INTEGER : sourceIds.indexOf(right.metadata.recordId)
    return leftOrder - rightOrder || left.entry.name.localeCompare(right.entry.name)
  })
  for (const item of indexedEntries) {
    const entry = item.entry
    const assetId = entry.name.slice(0, -5)
    let metadata: AssetMetadata | undefined = item.metadata
    let record: RecordData | undefined
    if (item.failure !== undefined) {
      receipts.push(receipt(branch, assetId, 'p0-r0', 1, 'blocked', item.failure))
      continue
    }
    try {
      if (metadata === undefined) throw new Error('unreadable')
      record = recordSchema.parse(JSON.parse(Buffer.from(await safeRead(paths.root, join(paths.records, `${metadata.recordId}.json`), 2 * 1024 * 1024)).toString('utf8')))
      if (record.record.id !== metadata.recordId || record.record.page !== metadata.page) throw new Error('stale-source')
    } catch (error) {
      const reason = failureReason(error)
      receipts.push(receipt(branch, assetId, metadata?.recordId ?? 'p0-r0', record?.revision ?? 1, 'blocked', reason))
      continue
    }
    if (!enabled) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'not-sent', 'not-enabled')); continue }
    if (record.record.kind !== 'table' && record.record.kind !== 'formula' && record.record.kind !== 'algorithm') { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'unwired')); continue }
    if (record.record.state !== 'present') { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'stale-source')); continue }
    if (metadata.availability !== 'available') { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'missing')); continue }
    try {
      const bytes = await safeRead(paths.root, join(paths.assets, `${assetId}.png`), IMAGE_LIMITS.maxImageBytes, 'image-too-large')
      const decoded = await decodePaperTaskPng(bytes)
      const context = JSON.stringify({ taskId: basename(paths.root), branch, assetId, recordId: metadata.recordId, revision: record.revision, page: metadata.page, bbox: metadata.bbox, kind: record.record.kind, text: record.record.text, context: record.record.context })
      const contextBytes = Buffer.byteLength(context)
      if (contextBytes > IMAGE_LIMITS.maxContextBytes) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'context-too-large')); continue }
      if (images.length >= IMAGE_LIMITS.maxImages) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'too-many-images')); continue }
      const data = Buffer.from(bytes).toString('base64')
      const encodedBytes = Buffer.byteLength(data)
      if (rawBytesTotal + bytes.byteLength > IMAGE_LIMITS.maxRawImageBytes || base64BytesTotal + encodedBytes > IMAGE_LIMITS.maxBase64ImageBytes) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'aggregate-image-too-large')); continue }
      const bodyBytes = Buffer.byteLength(JSON.stringify([...images, { assetId, recordId: metadata.recordId, revision: record.revision, context, data, ...decoded }]))
      if (bodyBytes > IMAGE_LIMITS.maxBodyBytes) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', 'request-too-large')); continue }
      rawBytesTotal += bytes.byteLength
      base64BytesTotal += encodedBytes
      images.push({ assetId, recordId: metadata.recordId, revision: record.revision, context, data, ...decoded })
      receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'not-sent', 'unwired'))
    } catch (error) { receipts.push(receipt(branch, assetId, metadata.recordId, record.revision, 'blocked', failureReason(error))) }
  }
  return { images, receipts }
}
