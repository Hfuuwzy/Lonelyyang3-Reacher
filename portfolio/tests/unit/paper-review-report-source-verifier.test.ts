import { describe, expect, it } from 'vitest'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { collectStructuralHeadings } from '../../server/utils/paper-review/source-matching'
import { verifyPaperReviewSource } from '../../server/paper-review-internal/report-source-verifier'

function pg(readerPage: number, headings: string[], lines: string[]): ExtractedPaperPage {
  return {
    readerPage,
    lines: lines.map((text) => ({ text, isHeading: headings.includes(text) })),
    headings,
    text: lines.join('\n'),
  }
}

describe('report-source-verifier headingless citations', () => {
  const pages: readonly ExtractedPaperPage[] = [
    pg(1, [], ['An abstract with no structural heading at all.']),
    pg(2, ['1 Introduction'], ['1 Introduction', 'This introduction sentence is quotable.']),
    pg(3, [], ['Continuation under the introduction heading.']),
  ]
  const context = { pages, pageCount: 3, headings: collectStructuralHeadings(pages) }

  it('keeps a citation honest when an empty heading is supplied for a genuinely headingless quote', () => {
    const result = verifyPaperReviewSource(
      { heading: '', readerPage: 1, quote: 'no structural heading' },
      context,
    )
    expect(result.grounded).toBe(true)
    // No preceding structural heading exists, so there is nothing to locate.
    expect(result.headingUnlocated).toBe(false)
  })

  it('flags an empty heading only when a structural heading genuinely exists at the quote', () => {
    const result = verifyPaperReviewSource(
      { heading: '', readerPage: 2, quote: 'This introduction sentence is quotable.' },
      context,
    )
    expect(result.grounded).toBe(true)
    // A preceding '1 Introduction' heading exists that the model failed to supply.
    expect(result.headingUnlocated).toBe(true)
  })

  it('still rejects a non-empty wrong heading as ungrounded', () => {
    const result = verifyPaperReviewSource(
      { heading: '99 Not A Real Heading', readerPage: 2, quote: 'This introduction sentence is quotable.' },
      context,
    )
    expect(result.grounded).toBe(false)
    expect(result.headingUnlocated).toBe(false)
  })

  it('keeps the inherited heading as the exact match across a continuation page', () => {
    const result = verifyPaperReviewSource(
      { heading: '1 Introduction', readerPage: 3, quote: 'Continuation under the introduction heading.' },
      context,
    )
    expect(result.grounded).toBe(true)
    expect(result.headingUnlocated).toBe(false)
  })
})