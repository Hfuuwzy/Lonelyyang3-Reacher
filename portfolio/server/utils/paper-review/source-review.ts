import type { PaperSourceInventory, PaperTranslationPair, PaperSourceReview, PaperReviewTaskGap } from '../../../app/utils/paper-review-task-contract'
import { isTranslationEligible } from '../../../app/utils/paper-review-task-contract'
import { z } from 'zod'
import { assertNever, sourceDigest, unitGap } from './source-ledger'
import { parseModelJson } from './model-json'
import { artifactGap } from './translation'

export interface FrozenPaperTranslation {
  readonly source: PaperSourceInventory
  readonly pairs: readonly PaperTranslationPair[]
  readonly reviewOf: string
}

export function freezePaperTranslation(source: PaperSourceInventory, pairs: readonly PaperTranslationPair[]): FrozenPaperTranslation {
  const frozenSource = Object.freeze({ ...source, units: Object.freeze(source.units.map(unit => {
    const spans = Object.freeze(unit.spans.map(span => Object.freeze({ ...span })))
    switch (unit.kind) {
      case 'caption': return Object.freeze({ ...unit, spans, mediaReaderPages: Object.freeze([...unit.mediaReaderPages]) })
      case 'excluded': return Object.freeze({ ...unit, spans, headingAnchor: Object.freeze({ ...unit.headingAnchor }) })
      case 'paragraph':
      case 'heading':
      case 'preserved-original':
      case 'unresolved':
        return Object.freeze({ ...unit, spans })
      default: return assertNever(unit)
    }
  })) })
  const frozenPairs = Object.freeze(pairs.map(pair => Object.freeze({ ...pair })))
  return Object.freeze({ source: frozenSource, pairs: frozenPairs, reviewOf: sourceDigest({ source: frozenSource, pairs: frozenPairs }) })
}

const checkSchema = z.object({
  unitId: z.string().min(1), kind: z.enum(['paragraph', 'heading', 'caption', 'excluded', 'preserved-original', 'unresolved']),
  classification: z.enum(['passed', 'issues']), translation: z.enum(['passed', 'issues', 'not-applicable']),
}).strict()

function reviewGap(frozen: FrozenPaperTranslation, unitId: string, code: string, origin: PaperReviewTaskGap['origin']): PaperReviewTaskGap {
  const unit = frozen.source.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) {
    return artifactGap('source-review', code)
  }
  return { ...unitGap(unit, 'source-review', code), origin }
}

/**
 * Validate one bounded source-review batch. The frozen global source/pairs
 * snapshot is never sliced; each request carries the same `reviewOf` digest and
 * only the expected batch ids. Checks for unknown, out-of-batch, duplicate, or
 * wrong-kind units are rejected and localized. Coverage is validated only
 * against the supplied batch ids.
 */
export function validateSourceReviewBatch(
  frozen: FrozenPaperTranslation,
  batchIds: readonly string[],
  raw: string,
): {
  readonly review: PaperSourceReview
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const parsed = z.object({ reviewOf: z.string(), checks: z.array(z.unknown()) }).safeParse(parseModelJson(raw))
  const gaps: PaperReviewTaskGap[] = []
  const fingerprintMatches = parsed.success && parsed.data.reviewOf === frozen.reviewOf
    && frozen.reviewOf === sourceDigest({ source: frozen.source, pairs: frozen.pairs })
  if (!fingerprintMatches) {
    gaps.push(artifactGap('source-review', 'review-fingerprint-mismatch'))
  }
  const expected = new Set(batchIds)
  const byId = new Map<string, z.infer<typeof checkSchema>[]>()
  for (const value of parsed.success ? parsed.data.checks : []) {
    const check = checkSchema.safeParse(value)
    if (!check.success) {
      gaps.push(artifactGap('source-review', 'invalid-check'))
      continue
    }
    const unit = frozen.source.units.find((candidate) => candidate.id === check.data.unitId)
    if (unit === undefined || !expected.has(check.data.unitId)) {
      gaps.push(artifactGap('source-review', 'out-of-batch-check'))
      continue
    }
    byId.set(check.data.unitId, [...(byId.get(check.data.unitId) ?? []), check.data])
  }

  const checks: { readonly unitId: string; readonly verdict: 'passed' | 'issues' }[] = []
  let anyIssue = false
  const orderedIds = frozen.source.units.filter((unit) => expected.has(unit.id)).map((unit) => unit.id)
  for (const unitId of orderedIds) {
    const unit = frozen.source.units.find((candidate) => candidate.id === unitId)!
    const matches = byId.get(unitId) ?? []
    const check = matches[0]
    const pairs = frozen.pairs.filter(pair => pair.unitId === unitId)
    const translationPasses = isTranslationEligible(unit)
      ? pairs.length === 1 && Boolean(pairs[0]?.chinese?.trim()) && check?.translation === 'passed'
      : pairs.length === 0 && check?.translation === 'not-applicable'
    const passed = fingerprintMatches && matches.length === 1 && check?.kind === unit.kind
      && check.classification === 'passed' && translationPasses && unit.kind !== 'unresolved'
    if (!passed) {
      anyIssue = true
      const code = matches.length === 0 ? 'missing-check' : matches.length > 1 ? 'duplicate-check' : unit.kind === 'unresolved' ? 'unresolved-unit' : 'review-issues'
      const origin: PaperReviewTaskGap['origin'] = code === 'review-issues' && fingerprintMatches ? 'model-review' : 'application'
      gaps.push(reviewGap(frozen, unitId, code, origin))
    }
    checks.push({ unitId, verdict: passed ? 'passed' : 'issues' })
  }

  return {
    review: {
      reviewOf: frozen.reviewOf,
      status: !anyIssue && fingerprintMatches && checks.length > 0 && gaps.length === 0 ? 'passed' : 'incomplete',
      checks,
    },
    gaps,
  }
}

export function validateSourceReview(frozen: FrozenPaperTranslation, raw: string): {
  readonly review: PaperSourceReview
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  return validateSourceReviewBatch(frozen, frozen.source.units.map((unit) => unit.id), raw)
}