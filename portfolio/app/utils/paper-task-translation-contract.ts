/**
 * Browser-safe contract for the natural Chinese translation master (issue #46).
 *
 * The reader receives the complete retained Markdown, not the bounded
 * progress excerpt. Internal paragraph/source associations stay on the server;
 * this view carries only what the preview needs: the master text, the original
 * assets it references, unresolved material, and which paragraphs a later
 * source correction invalidated.
 *
 * A readable master is still an unfinished preview. `complete` below means the
 * current controlled checks found no unresolved or stale material — it is not
 * a quality approval and does not prove sentence-level translation accuracy.
 */

import { z } from 'zod'

export const PAPER_TASK_TRANSLATION_STATUSES = ['complete', 'incomplete', 'needs-update'] as const
export type PaperTaskTranslationStatus = (typeof PAPER_TASK_TRANSLATION_STATUSES)[number]

export const PAPER_TASK_TRANSLATION_ASSET_KINDS = ['figure', 'table', 'formula', 'algorithm'] as const
export type PaperTaskTranslationAssetKind = (typeof PAPER_TASK_TRANSLATION_ASSET_KINDS)[number]

/** Application-controlled image scheme; only task-owned asset ids resolve. */
export const PAPER_TASK_ASSET_URL_SCHEME = 'asset:'

export const PAPER_TASK_TRANSLATION_LIMITS = {
  maxMarkdownLength: 400_000,
  maxAssets: 500,
  maxUnresolved: 500,
  maxStaleParagraphs: 400,
} as const

const translationAssetSchema = z.object({
  id: z.string().regex(/^asset-[0-9a-z]+$/),
  kind: z.enum(PAPER_TASK_TRANSLATION_ASSET_KINDS),
  caption: z.string().min(1).max(500),
  availability: z.enum(['available', 'missing']),
}).strict().readonly()

/** Shared reader-facing controlled asset shape for task-owned original crops. */
export const paperTaskControlledAssetSchema = translationAssetSchema

const unresolvedSchema = z.object({
  recordId: z.string().regex(/^p\d+-r\d+$/),
  reason: z.string().min(1).max(500),
}).strict().readonly()

export const paperTaskTranslationViewSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(PAPER_TASK_TRANSLATION_STATUSES),
  markdown: z.string().min(1).max(PAPER_TASK_TRANSLATION_LIMITS.maxMarkdownLength),
  assets: z.array(translationAssetSchema).max(PAPER_TASK_TRANSLATION_LIMITS.maxAssets).readonly(),
  unresolved: z.array(unresolvedSchema).max(PAPER_TASK_TRANSLATION_LIMITS.maxUnresolved).readonly(),
  staleParagraphs: z.array(z.number().int().nonnegative()).max(PAPER_TASK_TRANSLATION_LIMITS.maxStaleParagraphs).readonly(),
}).strict().readonly()

export type PaperTaskTranslationView = z.infer<typeof paperTaskTranslationViewSchema>
export type PaperTaskTranslationAsset = PaperTaskTranslationView['assets'][number]

export function projectPaperTaskTranslationView(
  payload: unknown,
  expectedTaskId: string,
): PaperTaskTranslationView | null {
  const view = paperTaskTranslationViewSchema.safeParse(payload)
  if (!view.success || view.data.taskId !== expectedTaskId) {
    return null
  }
  return view.data
}

export function paperTaskTranslationPath(taskId: string): string {
  return `/api/prototype/paper-task/${taskId}/translation`
}
