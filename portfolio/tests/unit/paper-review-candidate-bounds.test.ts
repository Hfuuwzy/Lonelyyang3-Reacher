import { describe, expect, it } from 'vitest'
import { buildSourceCandidates, MAX_CANDIDATE_SERIALIZED_CHARS } from '../../server/utils/paper-review/source-candidate'

describe('complete candidate record bounds', () => {
  it('includes span and exclusion metadata when splitting long source records', () => {
    const texts = ['References', ...Array.from({ length: 160 }, (_, index) => `Reference ${index}: a short source line.`)]
    const units = buildSourceCandidates([{ readerPage: 1, headings: [], text: texts.join('\n'),
      lines: texts.map(text => ({ text, isHeading: false })),
    }])
    expect(units.length).toBeGreaterThan(1)
    expect(units.every(unit => JSON.stringify(unit).length <= MAX_CANDIDATE_SERIALIZED_CHARS)).toBe(true)
    expect(units.every(unit => unit.exclusion?.reason === 'bibliography')).toBe(true)
    expect(units.flatMap(unit => unit.spans).map(span => span.lineIndex)).toEqual(texts.map((_, index) => index))
  })

  it('splits an oversized Unicode line without dividing surrogate pairs', () => {
    const original = '\ud83d\ude00'.repeat(2000)
    const units = buildSourceCandidates([{ readerPage: 1, headings: [], text: original,
      lines: [{ text: original, isHeading: false }],
    }])
    expect(units.map(unit => unit.text).join('')).toBe(original)
    expect(units.every(unit => JSON.stringify(unit).length <= MAX_CANDIDATE_SERIALIZED_CHARS)).toBe(true)
    expect(units.every(unit => !/[\ud800-\udbff]$/.test(unit.text) && !/^[\udc00-\udfff]/.test(unit.text))).toBe(true)
  })
})
