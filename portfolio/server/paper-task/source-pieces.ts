import { z } from 'zod'
import type { PaperTaskBranch } from '../../app/utils/paper-task-contract'
import type { StoredSourceRecord } from './source-store'
import type { DraftPieceMetadata } from './workspace'

const workerPieceSchema = z.object({
  paragraphIndex: z.number().int().positive(),
  recordId: z.string().regex(/^p\d+-r\d+$/),
  dependencyRecordIds: z.array(z.string().regex(/^p\d+-r\d+$/)).min(1).max(4),
}).strict()
export const workerPreviewSchema = z.object({
  type: z.literal('preview'),
  paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(8).readonly(),
  pieces: z.array(workerPieceSchema).max(6).readonly(),
}).passthrough()
export type PaperTaskWorkerPreview = z.infer<typeof workerPreviewSchema>

export type ValidatedWorkerPiece = {
  readonly id: string
  readonly paragraphIndex: number
  readonly dependencies: DraftPieceMetadata['dependencies']
}

export type ValidatedWorkerPreview = {
  readonly paragraphs: readonly string[]
  readonly pieces: readonly ValidatedWorkerPiece[]
}

export function validateWorkerPreview(
  event: unknown,
  branch: PaperTaskBranch,
  sourceRecords: readonly StoredSourceRecord[],
): ValidatedWorkerPreview | undefined {
  const parsed = workerPreviewSchema.safeParse(event)
  if (!parsed.success || parsed.data.paragraphs.length !== parsed.data.pieces.length + 1) return undefined
  const records = new Map(sourceRecords.map((entry) => [entry.record.id, entry]))
  const usedParagraphs = new Set<number>()
  const usedRecords = new Set<string>()
  const pieces: ValidatedWorkerPiece[] = []
  for (const workerPiece of parsed.data.pieces) {
    const source = records.get(workerPiece.recordId)
    if (source === undefined || source.record.state !== 'present' || workerPiece.paragraphIndex >= parsed.data.paragraphs.length
      || !['heading', 'body', 'appendix', 'footnote', 'figure', 'reference'].includes(source.record.kind)
      || usedParagraphs.has(workerPiece.paragraphIndex)
      || usedRecords.has(workerPiece.recordId)) return undefined
    const contextRecord = [...sourceRecords].reverse().find((candidate) =>
      candidate.record.order < source.record.order && candidate.record.text === source.record.context,
    )
    const expectedIds = new Set([source.record.id])
    if (source.record.sectionId !== null) expectedIds.add(source.record.sectionId)
    if (contextRecord !== undefined) expectedIds.add(contextRecord.record.id)
    if (workerPiece.dependencyRecordIds.length !== expectedIds.size
      || workerPiece.dependencyRecordIds.some((id) => !expectedIds.has(id))) return undefined
    const dependencies = [...expectedIds].map((recordId) => {
      const entry = records.get(recordId)
      return entry === undefined ? undefined : { recordId, revision: entry.revision }
    })
    if (dependencies.some((entry) => entry === undefined)) return undefined
    pieces.push({
      id: `${branch}-${source.record.id}`,
      paragraphIndex: workerPiece.paragraphIndex,
      dependencies: dependencies.filter((entry) => entry !== undefined),
    })
    usedParagraphs.add(workerPiece.paragraphIndex)
    usedRecords.add(workerPiece.recordId)
  }
  return { paragraphs: parsed.data.paragraphs, pieces }
}
