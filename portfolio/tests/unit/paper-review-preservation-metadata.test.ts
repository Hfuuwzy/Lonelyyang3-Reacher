import { describe, expect, it } from 'vitest'
import { buildSourceCandidates } from '../../server/utils/paper-review/source-candidate'
import type { ExtractedPaperLine, ExtractedPaperPage } from '../../server/utils/paper-review/pdf'

function page(lines: readonly ExtractedPaperLine[]): readonly ExtractedPaperPage[] {
  return [{ readerPage: 1, lines, headings: [], text: lines.map(line => line.text).join('\n') }]
}

describe('certified source preservation', () => {
  it('preserves a non-pipe table certified by the extractor', () => {
    const candidates = buildSourceCandidates(page([
      { text: 'Method Accuracy', isHeading: false, recognized: 'table' },
      { text: 'Baseline 92.4%', isHeading: false, recognized: 'table' },
    ]))
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.preserved).toBe('table-content')
    expect(candidates[0]?.text).toBe('Method Accuracy\nBaseline 92.4%')
  })

  it('retains a Unicode display expression without translating its internals', () => {
    const candidates = buildSourceCandidates(page([{ text: 'w\u02c6 \u223c p(w | w) for i \u2208 m (7)', isHeading: false }]))
    expect(candidates[0]?.preserved).toBe('formula')
  })

  it('does not preserve ordinary prose merely because it contains an equation', () => {
    const candidates = buildSourceCandidates(page([{ text: 'We use x = y to describe the method.', isHeading: false }]))
    expect(candidates[0]?.preserved).toBeUndefined()
  })

  it('keeps explicitly unsupported code separate from surrounding readable prose', () => {
    const candidates = buildSourceCandidates(page([
      { text: 'The method is described here', isHeading: false },
      { text: 'def example(x):', isHeading: false, recognized: 'code' },
      { text: 'Readable explanation continues.', isHeading: false },
    ]))
    expect(candidates.some(candidate => candidate.ambiguous && candidate.text === 'def example(x):')).toBe(true)
    expect(candidates.filter(candidate => candidate.text !== 'def example(x):').every(candidate => !candidate.ambiguous)).toBe(true)
  })
})
