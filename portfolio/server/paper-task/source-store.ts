import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  PaperTaskSource,
  PaperTaskSourceAsset,
  PaperTaskSourceRecord,
} from '../../app/utils/paper-task-source-contract'
import { PAPER_TASK_SOURCE_KINDS } from '../../app/utils/paper-task-source-contract'
import type { PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import { readPaperTaskImageReceipts } from './image-receipts'
import { workspacePaths } from './workspace'
import { readSourceDocument, writeSourceDocument } from './source-document.mjs'

export type StoredSourceRecord = {
  readonly record: PaperTaskSourceRecord
  readonly revision: number
}

export type PublicSourceAsset = {
  readonly id: string
  readonly recordId: string
  readonly page: number
  readonly bbox: readonly [number, number, number, number]
  readonly availability: 'available' | 'unavailable'
  readonly understanding: 'unverified'
}

export type StoredSource = {
  readonly source: Omit<PaperTaskSource, 'records'> & { readonly records: readonly (PaperTaskSourceRecord & { readonly revision: number })[] }
  readonly revision: number
  readonly assets: readonly PublicSourceAsset[]
  readonly imageInputs?: readonly PaperTaskImageReceipt[]
}

type AssetEntry = {
  readonly publicAsset: PublicSourceAsset
  readonly path: string
}

type RetainedSourceAsset = {
  readonly id: string
  readonly recordId: string
  readonly availability: PublicSourceAsset['availability']
  readonly understanding: 'unverified'
  readonly relativePath: string | null
}

type SourceState = {
  readonly root: string
  readonly recordsDir: string
  source: PaperTaskSource
  revision: number
  records: Map<string, StoredSourceRecord>
  assets: Map<string, AssetEntry>
  available: boolean
}

const RECORD_ID_PATTERN = /^p\d+-r\d+$/
const ASSET_ID_PATTERN = /^asset-[0-9a-f]{32}$/
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const

const sourceRecordSchema = z.object({
  id: z.string().regex(RECORD_ID_PATTERN),
  order: z.number().int().nonnegative(),
  kind: z.enum(PAPER_TASK_SOURCE_KINDS),
  text: z.string(),
  state: z.enum(['present', 'missing', 'ambiguous', 'unrecovered']),
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  sectionId: z.string().nullable(),
  context: z.string(),
  links: z.array(z.object({ kind: z.enum(['original', 'reference']), url: z.string() }).strict()),
}).strict()

const storedRecordSchema = z.object({
  record: sourceRecordSchema,
  revision: z.number().int().positive(),
}).strict()

const retainedStateSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'needs-confirmation']),
  pageCount: z.number().int().positive(),
  revision: z.number().int().positive(),
  assets: z.array(z.object({
    id: z.string().regex(ASSET_ID_PATTERN),
    recordId: z.string().regex(RECORD_ID_PATTERN),
    availability: z.enum(['available', 'unavailable']),
    understanding: z.literal('unverified'),
    relativePath: z.string().nullable(),
  }).strict()),
}).strict()

const sourceAssetSchema = z.object({
  id: z.string().regex(ASSET_ID_PATTERN),
  recordId: z.string().regex(RECORD_ID_PATTERN),
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  availability: z.enum(['available', 'unavailable']),
  understanding: z.literal('unverified'),
}).strict()

function retainedAsset(publicAsset: PublicSourceAsset): RetainedSourceAsset {
  return {
    id: publicAsset.id,
    recordId: publicAsset.recordId,
    availability: publicAsset.availability,
    understanding: publicAsset.understanding,
    relativePath: publicAsset.availability === 'available' ? `../../assets/${publicAsset.id}.png` : null,
  }
}

export function createPaperTaskSourceStore() {
  const tasks = new Map<string, SourceState>()

  function save(taskId: string, root: string, source: PaperTaskSource, assets: readonly PaperTaskSourceAsset[]): void {
    const paths = workspacePaths(root)
    const records = new Map<string, StoredSourceRecord>()
    for (const record of source.records) {
      if (!RECORD_ID_PATTERN.test(record.id)) throw new Error('unsupported source record id')
      const stored = { record, revision: 1 }
      writeFileSync(join(paths.sourceRecordsDir, `${record.id}.json`), JSON.stringify(stored))
      records.set(record.id, stored)
    }
    writeFileSync(join(paths.root, 'source-index.json'), JSON.stringify(source.records.map((record) => record.id)))
    const assetEntries = new Map<string, AssetEntry>()
    for (const asset of assets) {
      const record = records.get(asset.recordId)?.record
      if (record === undefined) throw new Error('asset has no source record')
      const id = `asset-${randomUUID().replaceAll('-', '')}`
      const path = join(paths.assetsDir, `${id}.png`)
      if (asset.availability === 'available' && asset.bytes !== null) writeFileSync(path, asset.bytes)
      const publicAsset: PublicSourceAsset = {
        id, recordId: asset.recordId, page: asset.page, bbox: asset.bbox,
        availability: asset.availability, understanding: 'unverified',
      }
      writeFileSync(join(paths.assetsDir, `${id}.json`), JSON.stringify(publicAsset))
      assetEntries.set(id, { publicAsset, path })
    }
    writeFileSync(paths.sourceStatePath, JSON.stringify({
      status: source.status,
      pageCount: source.pageCount,
      revision: 1,
      assets: [...assetEntries.values()].map(({ publicAsset }) => retainedAsset(publicAsset)),
    }))
    writeSourceDocument({ root, source, records: [...records.values()], assets: [...assetEntries.values()].map(({ publicAsset }) => publicAsset), revision: 1 })
    tasks.set(taskId, { root, recordsDir: paths.sourceRecordsDir, source, revision: 1, records, assets: assetEntries, available: true })
  }

  function restore(taskId: string, root: string): boolean {
    if (stateFor(taskId, root) !== undefined) return true
    try {
      const paths = workspacePaths(root)
      const sourceState = retainedStateSchema.parse(JSON.parse(readFileSync(paths.sourceStatePath, 'utf8')))
      const index = JSON.parse(readFileSync(join(paths.root, 'source-index.json'), 'utf8')) as unknown
      if (!Array.isArray(index) || index.length > 100_000
        || index.some((id) => typeof id !== 'string' || !RECORD_ID_PATTERN.test(id))
        || new Set(index).size !== index.length) return false

      const records = new Map<string, StoredSourceRecord>()
      const sourceRecords: PaperTaskSourceRecord[] = []
      for (const id of index as string[]) {
        const stored = storedRecordSchema.parse(JSON.parse(readFileSync(join(paths.sourceRecordsDir, `${id}.json`), 'utf8')))
        if (stored.record.id !== id || stored.revision > sourceState.revision) return false
        records.set(id, stored)
        sourceRecords.push(stored.record)
      }
      if (sourceRecords.some((record) => record.page > sourceState.pageCount)) return false

      const assets = new Map<string, AssetEntry>()
      for (const retained of sourceState.assets) {
        const expectedPath = retained.availability === 'available' ? `../../assets/${retained.id}.png` : null
        if (retained.relativePath !== expectedPath || !records.has(retained.recordId)) return false
        const publicAsset = sourceAssetSchema.parse(JSON.parse(readFileSync(join(paths.assetsDir, `${retained.id}.json`), 'utf8')))
        if (publicAsset.id !== retained.id || publicAsset.recordId !== retained.recordId
          || publicAsset.availability !== retained.availability || publicAsset.page > sourceState.pageCount) return false
        const path = join(paths.assetsDir, `${retained.id}.png`)
        const effectiveAsset = publicAsset.availability === 'available' && !validPng(path)
          ? { ...publicAsset, availability: 'unavailable' as const }
          : publicAsset
        assets.set(retained.id, { publicAsset: effectiveAsset, path })
      }

      const source: PaperTaskSource = {
        status: sourceState.status,
        pageCount: sourceState.pageCount,
        records: sourceRecords,
      }
      const sourceDocument = readSourceDocument(root)
      if (sourceDocument.metadata.sourceRevision !== sourceState.revision
        || sourceDocument.metadata.sourceStatus !== sourceState.status
        || sourceDocument.metadata.pageCount !== sourceState.pageCount
        || sourceDocument.metadata.sourceDigest !== sourceHash(JSON.stringify({ source, records: [...records.values()] }))
        || sourceDocument.metadata.assets.length !== sourceState.assets.length
        || sourceDocument.metadata.assets.some((asset, index) => {
          const retained = sourceState.assets[index]
          return retained === undefined || asset.id !== retained.id || asset.recordId !== retained.recordId
            || asset.availability !== retained.availability
        })) return false
      tasks.set(taskId, {
        root,
        recordsDir: paths.sourceRecordsDir,
        source,
        revision: sourceState.revision,
        records,
        assets,
        available: true,
      })
      return true
    } catch {
      return false
    }
  }

  function read(taskId: string, root: string): StoredSource | undefined {
    const state = stateFor(taskId, root)
    if (state === undefined || !state.available) return undefined
    return {
      source: {
        status: state.source.status,
        pageCount: state.source.pageCount,
        records: state.source.records.map((record) => {
          const stored = state.records.get(record.id)
          return { ...record, revision: stored?.revision ?? 1 }
        }),
      },
      revision: state.revision,
      assets: [...state.assets.values()].map((entry) => entry.publicAsset),
      imageInputs: readPaperTaskImageReceipts(root, [...state.records.values()], [...state.assets.values()].map(({ publicAsset }) => publicAsset)),
    }
  }

  function readAsset(taskId: string, root: string, assetId: string): Uint8Array | undefined {
    if (!ASSET_ID_PATTERN.test(assetId)) return undefined
    const state = stateFor(taskId, root)
    const entry = state?.available ? state.assets.get(assetId) : undefined
    if (entry === undefined || entry.publicAsset.availability !== 'available') return undefined
    const bytes = readFileSync(entry.path)
    if (bytes.byteLength > MAX_ASSET_BYTES || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return undefined
    return new Uint8Array(bytes)
  }

  function records(taskId: string, root: string): readonly StoredSourceRecord[] | undefined {
    const state = stateFor(taskId, root)
    return state?.available ? [...state.records.values()].sort((left, right) => left.record.order - right.record.order) : undefined
  }

  function workerReadPaths(taskId: string, root: string): readonly string[] {
    const state = stateFor(taskId, root)
    if (state === undefined || !state.available) return []
    const paths = workspacePaths(root)
    return [state.recordsDir, paths.originalPath, paths.assetsDir, paths.sourceStatePath, paths.sourceMarkdownPath, paths.sourceMetadataPath]
  }

  function replace(
    taskId: string,
    root: string,
    nextSource: PaperTaskSource,
    changedRecords: readonly StoredSourceRecord[],
    nextRevision: number,
  ): void {
    const state = stateFor(taskId, root)
    if (state === undefined || !state.available) throw new Error('source unavailable')
    const staged: { readonly temporary: string; readonly target: string }[] = []
    try {
      for (const item of changedRecords) {
        const previous = state.records.get(item.record.id)
        if (previous === undefined) throw new Error('source record unavailable')
        if (previous.revision + 1 !== item.revision) throw new Error('source revision mismatch')
        const target = join(state.recordsDir, `${item.record.id}.json`)
        const temporary = `${target}.${randomUUID()}.tmp`
        writeFileSync(temporary, JSON.stringify(item))
        staged.push({ temporary, target })
      }
      for (const item of staged) renameSync(item.temporary, item.target)
      writeFileSync(workspacePaths(root).sourceStatePath, JSON.stringify({
        status: nextSource.status,
        pageCount: nextSource.pageCount,
        revision: nextRevision,
        assets: [...state.assets.values()].map(({ publicAsset }) => retainedAsset(publicAsset)),
      }))
      const nextRecords = new Map(state.records)
      for (const item of changedRecords) nextRecords.set(item.record.id, item)
      writeSourceDocument({ root, source: nextSource, records: [...nextRecords.values()], assets: [...state.assets.values()].map(({ publicAsset }) => publicAsset), revision: nextRevision })
      state.source = nextSource
      state.revision = nextRevision
      for (const item of changedRecords) state.records.set(item.record.id, item)
    } catch (error) {
      state.available = false
      throw error
    } finally {
      for (const item of staged) rmSync(item.temporary, { force: true })
    }
  }

  function forget(taskId: string): void {
    tasks.delete(taskId)
  }

  function fence(taskId: string, root: string): void {
    const state = stateFor(taskId, root)
    if (state !== undefined) state.available = false
  }

  function stateFor(taskId: string, root: string): SourceState | undefined {
    const existing = tasks.get(taskId)
    return existing?.root === root ? existing : undefined
  }

  return { save, restore, read, readAsset, records, workerReadPaths, replace, fence, forget }
}

function validPng(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ASSET_BYTES) return false
    const bytes = readFileSync(path)
    return PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  } catch {
    return false
  }
}

function sourceHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
