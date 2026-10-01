import { describe, expect, it } from 'vitest'
import { paper29Groups, paper29Pages } from '../fixtures/paper-review-29'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { freezePaperTranslation, validateSourceReview } from '../../server/utils/paper-review/source-review'

describe('frozen model-based source comparison', () => {
  it.each(['passed', 'missing', 'duplicate', 'unknown', 'wrong-fingerprint', 'failed-classification', 'failed-translation', 'wrong-kind'])(
    'derives review coverage for %s checks without changing pairs', async fault => {
      // Given a frozen inventory/pair snapshot, including excluded and preserved units.
      const pages = await paper29Pages()
      const { source } = validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages) }))
      const pairs = source.units.slice(0, 6).map(unit => ({ unitId: unit.id, chinese: '原始译文，不得修改。' }))
      const frozen = freezePaperTranslation(source, pairs)
      const checks = source.units.map(unit => ({ unitId: unit.id, kind: unit.kind, classification: 'passed',
        translation: pairs.some(pair => pair.unitId === unit.id) ? 'passed' : 'not-applicable' }))
      const first = checks[0]
      if (!first) throw new Error('Missing fixture unit')
      let reviewOf = frozen.reviewOf
      switch (fault) {
        case 'missing': checks.pop(); break
        case 'duplicate': checks.push(first); break
        case 'unknown': checks.push({ ...first, unitId: 'unknown' }); break
        case 'wrong-fingerprint': reviewOf = 'stale'; break
        case 'failed-classification': checks[0] = { ...first, classification: 'issues' }; break
        case 'failed-translation': checks[0] = { ...first, translation: 'issues' }; break
        case 'wrong-kind': checks[0] = { ...first, kind: 'excluded' }; break
      }
      // When a distinct review response claims complete regardless of its checks.
      const result = validateSourceReview(frozen, JSON.stringify({ reviewOf, checks, status: 'complete', count: 10 }))
      // Then the application derives status and leaves the deeply frozen pairs untouched.
      expect(result.review.status).toBe(fault === 'passed' ? 'passed' : 'incomplete')
      expect(result.review.checks).toHaveLength(10)
      expect(result.gaps.length === 0).toBe(fault === 'passed')
      expect(frozen.pairs).toEqual(pairs)
      expect(Object.isFrozen(frozen.source.units[0]?.spans[0])).toBe(true)
      expect(Object.isFrozen(frozen.pairs[0])).toBe(true)
    },
  )
})
