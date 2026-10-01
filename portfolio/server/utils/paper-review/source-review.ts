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

export function validateSourceReview(frozen: FrozenPaperTranslation, raw: string): {
  readonly review: PaperSourceReview
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const parsed = z.object({ reviewOf: z.string(), checks: z.array(z.unknown()) }).safeParse(parseModelJson(raw))
  const gaps: PaperReviewTaskGap[] = []
  const fingerprintMatches = parsed.success && parsed.data.reviewOf === frozen.reviewOf
    && frozen.reviewOf === sourceDigest({ source: frozen.source, pairs: frozen.pairs })
  if (!fingerprintMatches) gaps.push(artifactGap('source-review', 'review-fingerprint-mismatch'))
  const byId = new Map<string, z.infer<typeof checkSchema>[]>()
  for (const value of parsed.success ? parsed.data.checks : []) {
    const check = checkSchema.safeParse(value)
    if (!check.success) { gaps.push(artifactGap('source-review', 'invalid-check')); continue }
    if (!frozen.source.units.some(unit => unit.id === check.data.unitId)) { gaps.push(artifactGap('source-review', 'unknown-check')); continue }
    byId.set(check.data.unitId, [...(byId.get(check.data.unitId) ?? []), check.data])
  }
  const checks: PaperSourceReview['checks'] = frozen.source.units.map(unit => {
    const matches = byId.get(unit.id) ?? []
    const check = matches[0]
    const pairs = frozen.pairs.filter(pair => pair.unitId === unit.id)
    const translationPasses = isTranslationEligible(unit)
      ? pairs.length === 1 && Boolean(pairs[0]?.chinese?.trim()) && check?.translation === 'passed'
      : pairs.length === 0 && check?.translation === 'not-applicable'
    const passed = fingerprintMatches && matches.length === 1 && check?.kind === unit.kind
      && check.classification === 'passed' && translationPasses && unit.kind !== 'unresolved'
    if (!passed) {
      const code = matches.length === 0 ? 'missing-check' : matches.length > 1 ? 'duplicate-check' : 'review-issues'
      gaps.push({ ...unitGap(unit, 'source-review', code), origin: code === 'review-issues' && fingerprintMatches ? 'model-review' : 'application' })
    }
    return { unitId: unit.id, verdict: passed ? 'passed' : 'issues' }
  })
  return { review: { reviewOf: frozen.reviewOf, status: gaps.length === 0 && checks.length > 0 ? 'passed' : 'incomplete', checks }, gaps }
}
