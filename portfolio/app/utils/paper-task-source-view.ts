import { z } from 'zod'

const PAPER_TASK_SOURCE_ASSET_KINDS = ['table', 'formula', 'algorithm'] as const
const PAPER_TASK_SOURCE_STATES = ['prepared', 'incomplete'] as const
const PAPER_TASK_SOURCE_AVAILABILITIES = ['available', 'missing'] as const

export const paperTaskSourceTaskIdSchema = z.string().uuid().brand('PaperTaskSourceTaskId')
export const paperTaskSourceAssetIdSchema = z.string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand('PaperTaskSourceAssetId')

const paperTaskSourceGapSchema = z.object({
  id: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
}).strict().readonly()

const paperTaskSourceAssetSchema = z.object({
  id: paperTaskSourceAssetIdSchema,
  kind: z.enum(PAPER_TASK_SOURCE_ASSET_KINDS),
  caption: z.string().min(1).max(500),
  availability: z.enum(PAPER_TASK_SOURCE_AVAILABILITIES),
  understanding: z.literal('unverified'),
}).strict().readonly()

export const paperTaskSourceViewSchema = z.object({
  taskId: paperTaskSourceTaskIdSchema,
  state: z.enum(PAPER_TASK_SOURCE_STATES),
  gaps: z.array(paperTaskSourceGapSchema).max(100).readonly(),
  assets: z.array(paperTaskSourceAssetSchema).max(100).readonly(),
}).strict().readonly()

export type PaperTaskSourceView = z.infer<typeof paperTaskSourceViewSchema>
export type PaperTaskSourceTaskId = z.infer<typeof paperTaskSourceTaskIdSchema>
export type PaperTaskSourceAssetId = z.infer<typeof paperTaskSourceAssetIdSchema>
export type PaperTaskSourceViewAsset = PaperTaskSourceView['assets'][number]

export function projectPaperTaskSourceView(payload: unknown, expectedTaskId: string): PaperTaskSourceView | null {
  const expectedId = paperTaskSourceTaskIdSchema.safeParse(expectedTaskId)
  if (!expectedId.success) {
    return null
  }

  const view = paperTaskSourceViewSchema.safeParse(payload)
  if (!view.success || view.data.taskId !== expectedId.data) {
    return null
  }

  return view.data
}

export function paperTaskSourceViewPath(taskId: PaperTaskSourceTaskId): string {
  return `/api/prototype/paper-task/${taskId}/source`
}

export function paperTaskSourceAssetPath(taskId: PaperTaskSourceTaskId, assetId: PaperTaskSourceAssetId): string {
  return `/api/prototype/paper-task/${taskId}/assets/${assetId}`
}
