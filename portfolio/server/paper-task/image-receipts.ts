import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { paperTaskIdSchema } from '../../app/utils/paper-task-contract'
import { paperTaskImageReceiptSchema, type PaperTaskImageBranch as PaperTaskBranch, type PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import { workspacePaths } from './workspace'

const RECEIPT_PATHS = ['drafts/translation/image-input.json', 'drafts/deep-reading/image-input.json'] as const
const MAX_RECEIPT_BYTES = 256 * 1024
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const assetMetadataSchema = z.object({ id: z.string(), recordId: z.string() }).passthrough()
const storedRecordSchema = z.object({ record: z.object({ id: z.string() }).passthrough(), revision: z.number().int().positive() }).passthrough()
const receiptFileSchema = z.object({ taskId: paperTaskIdSchema, branch: z.enum(['translation', 'deep-reading']), receipts: z.array(paperTaskImageReceiptSchema).max(100) }).strict()

function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function safeFilePath(root: string, path: string, maxBytes: number): string | undefined {
  try {
    const rootPath = resolve(root)
    if (lstatSync(rootPath).isSymbolicLink()) return undefined
    const canonicalRoot = realpathSync(rootPath)
    const relativePath = relative(rootPath, resolve(path))
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined
    const segments = relativePath.split(sep)
    let current = canonicalRoot
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      const info = lstatSync(current)
      if (info.isSymbolicLink()) return undefined
      if (index < segments.length - 1 && !info.isDirectory()) return undefined
      if (index === segments.length - 1 && (!info.isFile() || info.size > maxBytes)) return undefined
    }
    const canonicalFile = realpathSync(path)
    return contained(canonicalRoot, canonicalFile) ? canonicalFile : undefined
  } catch {
    return undefined
  }
}

function safeRead(root: string, path: string, maxBytes: number): string | undefined {
  const safePath = safeFilePath(root, path, maxBytes)
  return safePath === undefined ? undefined : readFileSync(safePath, 'utf8')
}

function safeDirectory(root: string, directory: string): string | undefined {
  try {
    const rootPath = resolve(root)
    if (lstatSync(rootPath).isSymbolicLink()) return undefined
    const canonicalRoot = realpathSync(rootPath)
    const relativePath = relative(rootPath, resolve(directory))
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined
    let current = canonicalRoot
    for (const segment of relativePath.split(sep)) {
      current = join(current, segment)
      const info = lstatSync(current)
      if (info.isSymbolicLink() || !info.isDirectory()) return undefined
    }
    const canonicalDirectory = realpathSync(directory)
    return contained(canonicalRoot, canonicalDirectory) ? canonicalDirectory : undefined
  } catch {
    return undefined
  }
}

function metadataFor(root: string, receipt: PaperTaskImageReceipt): boolean {
  try {
    const assetPath = join(root, 'assets', `${receipt.assetId}.json`)
    const recordPath = join(root, 'source-records', `${receipt.recordId}.json`)
    const assetText = safeRead(root, assetPath, MAX_METADATA_BYTES)
    const recordText = safeRead(root, recordPath, MAX_METADATA_BYTES)
    if (assetText === undefined || recordText === undefined) return false
    const asset = assetMetadataSchema.parse(JSON.parse(assetText))
    const record = storedRecordSchema.parse(JSON.parse(recordText))
    return asset.id === receipt.assetId && asset.recordId === receipt.recordId
      && record.record.id === receipt.recordId && record.revision === receipt.revision
  } catch {
    return false
  }
}

function existingReceiptFile(root: string, target: string, taskId: string, branch: PaperTaskBranch): z.infer<typeof receiptFileSchema> | undefined {
  let info
  try {
    info = lstatSync(target)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_RECEIPT_BYTES) throw new Error('unsafe paper task image receipt path')
  const content = safeRead(root, target, MAX_RECEIPT_BYTES)
  if (content === undefined) throw new Error('unsafe paper task image receipt path')
  const file = receiptFileSchema.parse(JSON.parse(content))
  if (file.taskId !== taskId || file.branch !== branch) throw new Error('foreign paper task image receipts')
  return file
}

export function savePaperTaskImageReceipts(root: string, branch: PaperTaskBranch, receipts: readonly PaperTaskImageReceipt[]): void {
  const taskId = paperTaskIdSchema.parse(basename(resolve(root)))
  const parsed = z.array(paperTaskImageReceiptSchema).max(100).parse(receipts)
  if (parsed.some((receipt) => receipt.branch !== branch || !metadataFor(root, receipt))) throw new Error('invalid paper task image receipts')
  const paths = workspacePaths(root)
  const directory = paths.branchDirectories[branch]
  const canonicalDirectory = safeDirectory(root, directory)
  if (canonicalDirectory === undefined) throw new Error('unsafe paper task image receipt path')
  const target = join(canonicalDirectory, 'image-input.json')
  existingReceiptFile(root, target, taskId, branch)
  const temporary = join(canonicalDirectory, `.image-input.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ taskId, branch, receipts: parsed }), { flag: 'wx', mode: 0o600 })
    if (safeFilePath(root, temporary, MAX_RECEIPT_BYTES) === undefined) throw new Error('unsafe paper task image receipt path')
    if (safeDirectory(root, directory) !== canonicalDirectory) throw new Error('unsafe paper task image receipt path')
    existingReceiptFile(root, target, taskId, branch)
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function readPaperTaskImageReceipts(
  root: string,
  records: readonly { readonly record: { readonly id: string }; readonly revision: number }[],
  assets: readonly { readonly id: string; readonly recordId: string }[],
): readonly PaperTaskImageReceipt[] {
  const taskId = paperTaskIdSchema.safeParse(basename(resolve(root)))
  if (!taskId.success) return []
  const recordMap = new Map(records.map(({ record, revision }) => [record.id, revision]))
  const assetMap = new Map(assets.map(({ id, recordId }) => [id, recordId]))
  const receipts: PaperTaskImageReceipt[] = []
  for (const path of RECEIPT_PATHS) {
    const filePath = join(root, ...path.split('/'))
    const safeFile = safeFilePath(root, filePath, MAX_RECEIPT_BYTES)
    if (safeFile === undefined) continue
    try {
      const file = receiptFileSchema.parse(JSON.parse(readFileSync(safeFile, 'utf8')))
      const branch = path.split('/')[1]
      if (file.taskId !== taskId.data || file.branch !== branch) continue
      for (const receipt of file.receipts) {
        if (receipt.branch !== file.branch || assetMap.get(receipt.assetId) !== receipt.recordId || !recordMap.has(receipt.recordId)) continue
        if (receipts.some((existing) => existing.assetId === receipt.assetId && existing.branch === receipt.branch)) continue
        const currentRevision = recordMap.get(receipt.recordId)
        receipts.push(currentRevision === receipt.revision ? receipt : { ...receipt, status: 'blocked', reason: 'stale-source' })
      }
    } catch {
      continue
    }
  }
  return receipts
}
