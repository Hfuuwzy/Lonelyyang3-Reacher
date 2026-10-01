/**
 * Browser-safe Zod schemas for the application-derived paper-review task-result
 * payload (issue #29).
 *
 * These schemas replace the hand-written #29 guards in `paper-review-contract.ts`
 * with Zod at the trust boundary, while preserving the wire shape and accepted
 * unknown properties (`passthrough`) of the previous guards exactly. No defaults,
 * coercions, or extra minimums are introduced beyond the invariants the old
 * guards already enforced: nonempty valid spans, `end > start`, positive reader
 * pages, and page-count bounds.
 *
 * The nested report inside a task result reuses the existing #27 pure guards
 * (`isPaperReviewSection` / `isPaperReviewGap`) from `paper-review-contract.ts`.
 * To avoid a runtime module cycle they are injected through
 * `createPaperReviewTaskResultSchema` rather than imported here.
 */

import { z } from 'zod'
import type { PaperReviewGap, PaperReviewSection } from './paper-review-contract'
import type {
  PaperReviewTaskGap,
  PaperReviewTaskResult,
  PaperSourceInventory,
  PaperSourceReview,
  PaperSourceSpan,
  PaperSourceUnit,
  PaperTranslationPair,
} from './paper-review-task-contract'

const positiveInteger = z.number().int().positive()

export const paperSourceSpanSchema: z.ZodType<PaperSourceSpan> = z.object({
  readerPage: positiveInteger,
  lineIndex: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
}).passthrough().superRefine((span, ctx) => {
  if (span.end <= span.start) {
    ctx.addIssue({ code: 'custom', message: 'span end must exceed start' })
  }
})

const baseUnitFields = {
  id: z.string(),
  spans: z.array(paperSourceSpanSchema).min(1),
  original: z.string(),
  heading: z.string(),
} as const

export const paperSourceUnitSchema: z.ZodType<PaperSourceUnit> = z.discriminatedUnion('kind', [
  z.object({ ...baseUnitFields, kind: z.literal('paragraph') }).passthrough(),
  z.object({ ...baseUnitFields, kind: z.literal('heading') }).passthrough(),
  z.object({ ...baseUnitFields, kind: z.literal('caption'), mediaReaderPages: z.array(positiveInteger) }).passthrough(),
  z.object({
    ...baseUnitFields,
    kind: z.literal('excluded'),
    reason: z.enum(['bibliography', 'appendix']),
    headingAnchor: paperSourceSpanSchema,
  }).passthrough(),
  z.object({
    ...baseUnitFields,
    kind: z.literal('preserved-original'),
    reason: z.enum(['formula', 'table-content', 'page-number']),
  }).passthrough(),
  z.object({ ...baseUnitFields, kind: z.literal('unresolved') }).passthrough(),
])

export const paperSourceInventorySchema: z.ZodType<PaperSourceInventory> = z.object({
  sourceId: z.string(),
  pageCount: positiveInteger,
  units: z.array(paperSourceUnitSchema),
}).passthrough().superRefine((inventory, ctx) => {
  const pageCount = inventory.pageCount
  const flag = (unit: PaperSourceUnit): void => {
    if (unit.spans.some(span => span.readerPage > pageCount)) {
      ctx.addIssue({ code: 'custom', message: 'span readerPage exceeds pageCount' })
    }
    if (unit.kind === 'caption' && unit.mediaReaderPages.some(page => page > pageCount)) {
      ctx.addIssue({ code: 'custom', message: 'caption mediaReaderPage exceeds pageCount' })
    }
    if (unit.kind === 'excluded' && unit.headingAnchor.readerPage > pageCount) {
      ctx.addIssue({ code: 'custom', message: 'exclusion headingAnchor readerPage exceeds pageCount' })
    }
  }
  for (const unit of inventory.units) {
    flag(unit)
  }
})

export const paperTranslationPairSchema: z.ZodType<PaperTranslationPair> = z.object({
  unitId: z.string(),
  chinese: z.union([z.string(), z.null()]),
}).passthrough()

export const paperSourceReviewSchema: z.ZodType<PaperSourceReview> = z.object({
  reviewOf: z.string(),
  status: z.enum(['not-run', 'incomplete', 'passed']),
  checks: z.array(z.object({
    unitId: z.string(),
    verdict: z.enum(['passed', 'issues']),
  }).passthrough()),
}).passthrough()

export const paperReviewTaskGapSchema: z.ZodType<PaperReviewTaskGap> = z.object({
  artifact: z.enum(['source', 'report', 'translation', 'source-review']),
  code: z.string(),
  origin: z.enum(['application', 'model-report', 'model-review']),
  unitIds: z.array(z.string()),
  readerPages: z.array(positiveInteger),
  spans: z.array(paperSourceSpanSchema),
  reason: z.string(),
}).passthrough()

/**
 * Callbacks for the nested report data of a task result, reusing the existing
 * #27 pure guards from `paper-review-contract.ts`.
 */
export interface PaperReviewTaskReportGuards {
  readonly isPaperReviewSection: (value: unknown) => value is PaperReviewSection
  readonly isPaperReviewGap: (value: unknown) => value is PaperReviewGap
}

/** Composes the full terminal task-result schema over injected report guards. */
export function createPaperReviewTaskResultSchema(guards: PaperReviewTaskReportGuards): z.ZodType<PaperReviewTaskResult> {
  const reportSchema = z.object({
    sections: z.array(z.custom<PaperReviewSection>(guards.isPaperReviewSection)),
    gaps: z.array(z.custom<PaperReviewGap>(guards.isPaperReviewGap)),
  }).passthrough()
  return z.object({
    status: z.enum(['complete', 'incomplete']),
    provider: z.string(),
    model: z.string(),
    source: paperSourceInventorySchema,
    report: reportSchema.nullable(),
    translation: z.object({
      pairs: z.array(paperTranslationPairSchema),
      review: paperSourceReviewSchema,
    }).passthrough(),
    gaps: z.array(paperReviewTaskGapSchema),
  }).passthrough()
}