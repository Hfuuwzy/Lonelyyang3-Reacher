import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PaperTaskSourceRecord } from '../../app/utils/paper-task-source-contract'
import type { PaperTaskBranch } from '../../app/utils/paper-task-contract'
import { workspacePaths } from './workspace'
import { createPaperTaskSourceStore, type StoredSourceRecord } from './source-store'

export const paperTaskCorrectionSchema = z.object({
  expectedSourceRevision: z.number().int().positive(),
  corrections: z.array(z.object({
    recordId: z.string().regex(/^p\d+-r\d+$/),
    expectedRecordRevision: z.number().int().positive(),
    text: z.string().trim().min(1).max(10000),
  }).strict()).min(1).max(20),
}).strict()

export type PaperTaskCorrection = z.infer<typeof paperTaskCorrectionSchema>
export type PaperTaskCorrectionResult =
  | { readonly kind: 'corrected'; readonly revision: number }
  | { readonly kind: 'unchanged'; readonly revision: number }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }

const draftPieceSchema = z.object({
  id: z.string().regex(/^(?:translation|deep-reading)-p\d+-r\d+$/),
  dependencies: z.array(z.object({ recordId: z.string().regex(/^p\d+-r\d+$/), revision: z.number().int().positive() }).strict()),
  stale: z.boolean(),
}).strict()

const translationMetadataSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'needs-update']),
  sourceRevision: z.number().int().positive(),
  segments: z.array(z.object({
    index: z.number().int().nonnegative(),
    markdown: z.string(),
    stale: z.boolean(),
    dependencies: z.array(z.object({ recordId: z.string().regex(/^p\d+-r\d+$/), revision: z.number().int().positive() }).strict()),
  }).strict()).min(1),
}).passthrough()

type RetainedStaleUpdate = { readonly path: string; readonly contents: string }

export function correctPaperTaskSource(
  store: ReturnType<typeof createPaperTaskSourceStore>,
  taskId: string,
  root: string,
  input: PaperTaskCorrection,
): PaperTaskCorrectionResult {
  const current = store.read(taskId, root)
  const records = store.records(taskId, root)
  if (current === undefined || records === undefined) return { kind: 'unavailable' }
  if (current.revision !== input.expectedSourceRevision) return { kind: 'conflict' }

  const byId = new Map(records.map((item) => [item.record.id, item]))
  const correctedIds = new Set<string>()
  for (const correction of input.corrections) {
    const existing = byId.get(correction.recordId)
    if (existing === undefined || existing.record.state !== 'present' || existing.record.kind === 'gap'
      || correctedIds.has(correction.recordId)) return { kind: 'invalid' }
    if (existing.revision !== correction.expectedRecordRevision) return { kind: 'conflict' }
    correctedIds.add(correction.recordId)
  }

  const changed = new Map<string, StoredSourceRecord>()
  const requested = new Map(input.corrections.map((correction) => [correction.recordId, correction.text]))
  let context = ''
  let sectionId: string | null = null
  for (const existing of records) {
    const text = requested.get(existing.record.id) ?? existing.record.text
    const heading = existing.record.kind === 'heading' || existing.record.kind === 'appendix'
    if (heading) {
      sectionId = existing.record.id
      context = text
    }
    const nextContext = existing.record.kind === 'gap' ? existing.record.context : context
    if (text !== existing.record.text || nextContext !== existing.record.context || sectionId !== existing.record.sectionId) {
      changed.set(existing.record.id, {
        record: { ...existing.record, text, context: nextContext, sectionId },
        revision: existing.revision + 1,
      })
    }
    if (!heading && existing.record.kind !== 'gap') context = text
  }
  if (changed.size === 0) return { kind: 'unchanged', revision: current.revision }

  const nextRecords = records.map((item) => changed.get(item.record.id) ?? item)
  const sourceRecords: readonly PaperTaskSourceRecord[] = nextRecords.map((item) => item.record)
  const hasUnavailableAssets = current.assets.some((asset) => asset.availability !== 'available')
  const nextSource = {
    ...current.source,
    status: hasUnavailableAssets ? 'incomplete' as const : current.source.status,
    records: sourceRecords,
  }
  const nextRevision = current.revision + 1
  const staleMetadata = findStalePieces(root, changed, nextRevision)
  if (staleMetadata === undefined) return { kind: 'unavailable' }
  try {
    store.replace(taskId, root, nextSource, [...changed.values()], nextRevision)
    for (const item of staleMetadata) writeFileSync(item.path, item.contents)
  } catch {
    store.fence(taskId, root)
    return { kind: 'unavailable' }
  }
  return { kind: 'corrected', revision: nextRevision }
}

function findStalePieces(
  root: string,
  changed: ReadonlyMap<string, StoredSourceRecord>,
  nextRevision: number,
): readonly RetainedStaleUpdate[] | undefined {
  const changedIds = new Set(changed.keys())
  const branches: readonly PaperTaskBranch[] = ['translation', 'deep-reading']
  const stale: RetainedStaleUpdate[] = []
  try {
    for (const branch of branches) {
      const directory = join(workspacePaths(root).branchDirectories[branch], 'pieces')
      for (const filename of readdirSync(directory)) {
        if (!filename.endsWith('.json')) continue
        const path = join(directory, filename)
        const parsed = draftPieceSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
        if (!parsed.success) return undefined
        if (parsed.data.stale || !parsed.data.dependencies.some((dependency) => changedIds.has(dependency.recordId))) continue
        stale.push({ path, contents: JSON.stringify({ ...parsed.data, stale: true }) })
      }
    }
    const translation = translationMetadata(root)
    if (translation !== undefined) {
      const affected = translation.segments.some((segment) =>
        segment.dependencies.some((dependency) => changedIds.has(dependency.recordId)),
      )
      if (affected) {
        const segments = translation.segments.map((segment) =>
          segment.stale || !segment.dependencies.some((dependency) => changedIds.has(dependency.recordId))
            ? segment
            : { ...segment, stale: true },
        )
        stale.push({
          path: join(workspacePaths(root).branchDirectories.translation, 'translation.json'),
          contents: JSON.stringify({ ...translation, status: 'needs-update', sourceRevision: nextRevision, segments }),
        })
      }
    }
    return stale
  } catch {
    return undefined
  }
}

function translationMetadata(root: string): z.infer<typeof translationMetadataSchema> | undefined {
  const path = join(workspacePaths(root).branchDirectories.translation, 'translation.json')
  try {
    const parsed = translationMetadataSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
