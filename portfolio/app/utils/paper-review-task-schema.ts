/**
 * Browser-safe Zod schemas for the application-derived paper-review task-result
 * payload (issue #29).
 *
 * These schemas replace the hand-written #29 guards in `paper-review-contract.ts`
 * with Zod at the trust boundary, while preserving the wire shape and accepted
 * unknown properties (`passthrough`) of the previous guards exactly. No defaults
 * or coercions are introduced beyond the invariants the old guards already
 * enforced — nonempty valid spans, `end > start`, positive reader pages, and
 * page-count bounds — plus two boundary additions:
 *   - report findings must cite a `readerPage` within `1..source.pageCount` for
 *     either status, and
 *   - a `complete` status must agree with the server's completion derivation in
 *     `pipeline-outcomes.ts`: a non-null report with no report/task gaps, a
 *     nonempty eligible source-unit set with unique ids and no unresolved units,
 *     exactly one nonblank translation pair per eligible unit (no extra,
 *     duplicate, or ineligible pairs), and exactly one passed review check per
 *     source unit (no extra, duplicate, or failed checks).
 *
 * The nested report inside a task result reuses the existing #27 pure guards
 * (`isPaperReviewSection` / `isPaperReviewGap`) from `paper-review-contract.ts`.
 * To avoid a runtime module cycle they are injected through
 * `createPaperReviewTaskResultSchema` rather than imported here.
 */

import { z } from 'zod'
import { isTranslationEligible } from './paper-review-task-contract'
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
  }).passthrough().superRefine((result, ctx) => {
    const { pageCount } = result.source
    if (result.report !== null && Array.isArray(result.report.sections)) {
      result.report.sections.forEach((section, sectionIndex) => {
        if (!Array.isArray(section.findings)) {
          return
        }
        section.findings.forEach((finding, findingIndex) => {
          if (finding.source.readerPage > pageCount) {
            ctx.addIssue({
              code: 'custom',
              message: 'report finding readerPage exceeds pageCount',
              path: ['report', 'sections', sectionIndex, 'findings', findingIndex, 'source', 'readerPage'],
            })
          }
        })
      })
    }

    if (result.status !== 'complete') {
      return
    }

    if (result.report === null) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires a non-null report' })
      return
    }
    if (result.report.gaps.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires no report gaps' })
    }
    if (result.gaps.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires no task gaps' })
    }
    if (result.source.units.filter(isTranslationEligible).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires at least one eligible source unit' })
    }
    if (!sourceUnitIdsAreUnique(result.source.units)) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires unique source unit ids' })
    }
    if (!hasNoUnresolvedUnits(result.source.units)) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires no unresolved source units' })
    }
    if (!everyEligibleUnitHasOneNonblankPair(result.source.units, result.translation.pairs)) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires exactly one nonblank translation pair per eligible unit' })
    }
    if (result.translation.review.status !== 'passed'
      || !everySourceUnitHasOnePassedCheck(result.source.units, result.translation.review.checks)) {
      ctx.addIssue({ code: 'custom', message: 'complete result requires exactly one passed review check per source unit' })
    }
  })
}

function sourceUnitIdsAreUnique(units: readonly PaperSourceUnit[]): boolean {
  return new Set(units.map((unit) => unit.id)).size === units.length
}

function hasNoUnresolvedUnits(units: readonly PaperSourceUnit[]): boolean {
  return units.every((unit) => unit.kind !== 'unresolved')
}

/** Every eligible unit has exactly one nonblank pair, with no extra, duplicate,
 * or ineligible pairs (mirrors `everyEligibleUnitHasOneNonblankPair`). */
function everyEligibleUnitHasOneNonblankPair(
  units: readonly PaperSourceUnit[],
  pairs: readonly PaperTranslationPair[],
): boolean {
  const eligibleIds = new Set(units.filter(isTranslationEligible).map((unit) => unit.id))
  const seen = new Set<string>()
  for (const pair of pairs) {
    if (!eligibleIds.has(pair.unitId) || seen.has(pair.unitId)) {
      return false
    }
    seen.add(pair.unitId)
    if (pair.chinese === null || pair.chinese.trim() === '') {
      return false
    }
  }
  return seen.size === eligibleIds.size
}

/** Every source unit has exactly one passed check, with no extra, duplicate, or
 * failed checks. */
function everySourceUnitHasOnePassedCheck(
  units: readonly PaperSourceUnit[],
  checks: PaperSourceReview['checks'],
): boolean {
  const unitIds = new Set(units.map((unit) => unit.id))
  const seen = new Set<string>()
  for (const check of checks) {
    if (check.verdict !== 'passed' || !unitIds.has(check.unitId) || seen.has(check.unitId)) {
      return false
    }
    seen.add(check.unitId)
  }
  return seen.size === unitIds.size
}