/**
 * Browser-safe contract for the retained deep-reading report (issue #48).
 *
 * The reader receives the complete retained Markdown report, never the bounded
 * progress excerpt. Internal source records, page locations, and evidence
 * claims stay on the server. A readable report remains a preview unless the
 * branch itself reached `complete`; the branch state travels separately from
 * this view.
 */

import { z } from 'zod'
import {
  paperTaskControlledAssetSchema,
  type PaperTaskTranslationAssetKind,
} from './paper-task-translation-contract'

export const PAPER_TASK_READING_STATUSES = ['preview', 'needs-confirmation'] as const
export type PaperTaskReadingStatus = (typeof PAPER_TASK_READING_STATUSES)[number]

export const PAPER_TASK_READING_ASSET_KINDS = ['figure', 'table', 'formula', 'algorithm'] as const

export const PAPER_TASK_READING_LIMITS = {
  maxMarkdownLength: 400_000,
  maxAssets: 500,
} as const

export const paperTaskReadingViewSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(PAPER_TASK_READING_STATUSES),
  markdown: z.string().min(1).max(PAPER_TASK_READING_LIMITS.maxMarkdownLength),
  assets: z.array(paperTaskControlledAssetSchema).max(PAPER_TASK_READING_LIMITS.maxAssets).readonly(),
}).strict().readonly()

export type PaperTaskReadingView = z.infer<typeof paperTaskReadingViewSchema>
export type PaperTaskReadingAsset = PaperTaskReadingView['assets'][number]
export type PaperTaskReadingAssetKind = PaperTaskTranslationAssetKind

export function projectPaperTaskReadingView(
  payload: unknown,
  expectedTaskId: string,
): PaperTaskReadingView | null {
  const view = paperTaskReadingViewSchema.safeParse(payload)
  if (!view.success || view.data.taskId !== expectedTaskId) {
    return null
  }
  return view.data
}
