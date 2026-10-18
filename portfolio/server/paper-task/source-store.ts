import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PaperTaskSource,
  PaperTaskSourceAsset,
  PaperTaskSourceRecord,
} from '../../app/utils/paper-task-source-contract'
import type { PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import { readPaperTaskImageReceipts } from './image-receipts'
import { workspacePaths } from './workspace'

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
    tasks.set(taskId, { root, recordsDir: paths.sourceRecordsDir, source, revision: 1, records, assets: assetEntries, available: true })
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
    return [state.recordsDir, paths.originalPath, paths.assetsDir, paths.sourceStatePath]
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

  return { save, read, readAsset, records, workerReadPaths, replace, fence, forget }
}
