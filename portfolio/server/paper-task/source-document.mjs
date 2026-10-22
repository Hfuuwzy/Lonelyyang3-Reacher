import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const EXTRACTOR_VERSION = 'paper-source-markdown-v1'
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const metadataSchema = z.object({
  version: z.literal(1), extractorVersion: z.string(), pdfSha256: digestSchema,
  markdownSha256: digestSchema, fingerprint: digestSchema, sourceDigest: digestSchema,
  assetDigest: digestSchema, sourceRevision: z.number().int().positive(),
  sourceStatus: z.enum(['complete', 'incomplete', 'needs-confirmation']),
  pageCount: z.number().int().positive(), byteLength: z.number().int().nonnegative(),
  pages: z.array(z.object({ page: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })),
  assets: z.array(z.object({
    id: z.string().regex(/^asset-[a-z0-9]+$/u), recordId: z.string(), page: z.number().int().positive(),
    kind: z.string(), caption: z.string(), availability: z.enum(['available', 'unavailable']), understanding: z.literal('unverified'),
  })),
  records: z.array(z.object({ id: z.string(), revision: z.number().int().positive(), page: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })),
})

export function sourceHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readSnapshot(root, checkPdf) {
  const canonical = realpathSync(root)
  for (const name of ['source.md', 'source.meta.json']) {
    const path = join(canonical, name)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) throw new Error('source document file is invalid')
  }
  const metadata = metadataSchema.parse(JSON.parse(readFileSync(join(canonical, 'source.meta.json'), 'utf8')))
  const bytes = readFileSync(join(canonical, 'source.md'))
  if (bytes.byteLength !== metadata.byteLength || sourceHash(bytes) !== metadata.markdownSha256) throw new Error('source Markdown does not match its preparation receipt')
  if (checkPdf && sourceHash(readFileSync(join(canonical, 'original.pdf'))) !== metadata.pdfSha256) throw new Error('original PDF changed after source preparation')
  if (metadata.fingerprint !== fingerprint(metadata)) throw new Error('source fingerprint is invalid')
  let pageEnd = Buffer.byteLength('# Source document\n\nOriginal extracted text. Page markers and extraction notices are preparation metadata, not paper claims.\n\n', 'utf8')
  if (metadata.pages.length !== metadata.pageCount || metadata.records.length > 100_000) throw new Error('source tables are invalid')
  for (const [index, page] of metadata.pages.entries()) {
    if (page.page !== index + 1 || page.start !== pageEnd || page.end < page.start || page.end > metadata.byteLength) throw new Error('source page ranges are invalid')
    pageEnd = page.end
  }
  if (pageEnd !== metadata.byteLength) throw new Error('source page ranges are incomplete')
  const recordIds = new Set()
  let recordEnd = 0
  for (const record of metadata.records) {
    const page = metadata.pages[record.page - 1]
    if (page === undefined || recordIds.has(record.id) || record.revision > metadata.sourceRevision
      || record.start < page.start || record.end <= record.start || record.end > page.end || record.start < recordEnd
      || (bytes[record.start] & 0xc0) === 0x80 || (bytes[record.end] & 0xc0) === 0x80) throw new Error('source record ranges are invalid')
    recordIds.add(record.id)
    recordEnd = record.end
  }
  return { markdown: bytes.toString('utf8'), metadata }
}

export function readSourceDocument(root) {
  return readSnapshot(root, true)
}

function fingerprint(metadata) {
  return sourceHash(JSON.stringify([
    metadata.version, metadata.extractorVersion, metadata.pdfSha256, metadata.sourceRevision,
    metadata.sourceDigest, metadata.assetDigest, metadata.sourceStatus, metadata.pageCount,
    metadata.byteLength, metadata.markdownSha256, metadata.pages, metadata.records, metadata.assets,
  ]))
}

function atomicWrite(root, name, contents) {
  const path = join(root, name)
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('source destination is not a regular file')
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function writeSourceDocument({ root, source, records, assets, revision }) {
  const pdfSha256 = sourceHash(readFileSync(join(root, 'original.pdf')))
  const sourceDigest = sourceHash(JSON.stringify({ source, records }))
  const byId = new Map(records.map((stored) => [stored.record.id, stored.record]))
  const retainedAssets = assets.map((asset) => {
    const record = byId.get(asset.recordId)
    if (record === undefined) throw new Error('source asset record is unavailable')
    return {
      id: asset.id, recordId: asset.recordId, page: asset.page, kind: record.kind,
      caption: (record.text.trim().split('\n')[0] ?? '').slice(0, 300),
      availability: asset.availability, understanding: 'unverified',
    }
  })
  const assetDigest = sourceHash(JSON.stringify(retainedAssets))
  if (existsSync(join(root, 'source.meta.json'))) {
    const previous = readSnapshot(root, false)
    if (previous.metadata.pdfSha256 === pdfSha256 && previous.metadata.sourceDigest === sourceDigest
      && previous.metadata.assetDigest === assetDigest && previous.metadata.sourceRevision === revision
      && previous.metadata.extractorVersion === EXTRACTOR_VERSION) return previous
  }
  const chunks = ['# Source document\n\nOriginal extracted text. Page markers and extraction notices are preparation metadata, not paper claims.\n\n']
  const pages = [], locations = []
  let position = Buffer.byteLength(chunks[0], 'utf8')
  const append = (text) => { chunks.push(text); position += Buffer.byteLength(text, 'utf8') }
  for (let page = 1; page <= source.pageCount; page++) {
    const start = position
    append(`## Page ${page}\n\n`)
    const pageRecords = records.filter((stored) => stored.record.page === page)
    if (pageRecords.some((stored) => stored.record.state === 'ambiguous')) append('[Extraction warning: some text or reading order on this page is uncertain.]\n\n')
    if (pageRecords.length === 0 || pageRecords.every((stored) => stored.record.kind === 'gap')) append('[Source extraction gap: no recoverable text on this page.]\n\n')
    for (const stored of pageRecords) {
      const text = stored.record.text
      if (text.length === 0) continue
      const recordStart = position
      append(`${text}\n`)
      locations.push({ id: stored.record.id, revision: stored.revision, page, start: recordStart, end: position - 1 })
    }
    append('\n')
    for (const asset of retainedAssets.filter((entry) => entry.page === page)) {
      const caption = asset.caption.replace(/[\[\]\r\n]/gu, ' ')
      append(asset.availability === 'available'
        ? `![Original ${asset.kind}: ${caption}](asset:${asset.id})\n\n`
        : `[Original ${asset.kind} crop unavailable: ${caption}]\n\n`)
    }
    pages.push({ page, start, end: position })
  }
  const markdown = chunks.join('')
  const metadata = {
    version: 1, extractorVersion: EXTRACTOR_VERSION, pdfSha256, sourceDigest, assetDigest,
    sourceRevision: revision, sourceStatus: source.status, pageCount: source.pageCount,
    byteLength: Buffer.byteLength(markdown, 'utf8'), markdownSha256: sourceHash(markdown),
    pages, records: locations, assets: retainedAssets,
  }
  const result = { ...metadata, fingerprint: fingerprint(metadata) }
  atomicWrite(root, 'source.md', markdown)
  atomicWrite(root, 'source.meta.json', JSON.stringify(result))
  return { markdown, metadata: metadataSchema.parse(result) }
}
