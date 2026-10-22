import { describe, expect, it } from 'vitest'
import { verifyPaperReview } from '../../server/utils/paper-review/report'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import type { PaperReviewReport } from '../../app/utils/paper-review-contract'

const PROVIDER = 'local'
const MODEL = 'fixture-model'

function pg(readerPage: number, headings: string[], lines: string[]): ExtractedPaperPage {
  return {
    readerPage,
    lines: lines.map((text) => ({ text, isHeading: headings.includes(text) })),
    headings,
    text: lines.join('\n'),
  }
}

function finding(
  statement: string,
  heading: string,
  readerPage: number,
  quote: string,
  printedPage?: string,
): unknown {
  return {
    statement,
    source: { heading, readerPage, quote, ...(printedPage === undefined ? {} : { printedPage }) },
  }
}

function raw(...sections: Array<{ kind: string; title: string; findings: unknown[] }>): string {
  return JSON.stringify({ sections })
}

function sectionByKind(report: PaperReviewReport, kind: string): PaperReviewReport['sections'][number] | undefined {
  return report.sections.find((section) => section.kind === kind)
}

function statementsOf(report: PaperReviewReport, kind: string): string[] {
  return (sectionByKind(report, kind)?.findings ?? []).map((f) => f.statement)
}

describe('verifyPaperReview heading inheritance (continuation pages)', () => {
  const continuationPages: readonly ExtractedPaperPage[] = [
    pg(1, ['1 Introduction'], ['1 Introduction', 'The quick brown fox jumps over the lazy dog.']),
    pg(2, [], ['This paragraph continues the introduction without a new heading.']),
  ]

  function buildWith(rawPayload: string, customPages: readonly ExtractedPaperPage[]): PaperReviewReport {
    const result = verifyPaperReview(rawPayload, customPages, PROVIDER, MODEL)
    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('expected a successful report but got a failure')
    }
    return result.report
  }

  it('accepts a quote on a headingless page under the inherited previous heading', () => {
    // Given a finding citing a continuation page quote under the section heading
    // that started on the previous page.
    const report = buildWith(
      raw({ kind: 'claims', title: 'Claims', findings: [finding('inherited heading', '1 Introduction', 2, 'This paragraph continues the introduction without a new heading.')] }),
      continuationPages,
    )
    // Then the finding is kept with the inherited heading and no citation gap.
    const claim = sectionByKind(report, 'claims')?.findings[0]
    expect(claim?.source.heading).toBe('1 Introduction')
    expect(claim?.source.readerPage).toBe(2)
    expect(report.gaps.map((g) => g.section)).not.toContain('Claims')
  })

  it('accepts an empty heading on a continuation page without inventing one', () => {
    // Given a finding on a headingless page that leaves the heading unspecified.
    const report = buildWith(
      raw({ kind: 'claims', title: 'Claims', findings: [finding('unspecified heading', '', 2, 'This paragraph continues the introduction without a new heading.')] }),
      continuationPages,
    )
    // Then the finding is kept with an empty heading and a scope-warning gap.
    const claim = sectionByKind(report, 'claims')?.findings[0]
    expect(claim?.source.heading).toBe('')
    expect(report.gaps).toContainEqual({ section: 'Claims', reason: expect.stringContaining('未指明所属章节标题') })
  })
})

describe('verifyPaperReview rejects superseded, future, and fabricated headings', () => {
  const supersededPages: readonly ExtractedPaperPage[] = [
    pg(1, ['1 Introduction'], ['1 Introduction', 'Intro text.']),
    pg(2, ['2 Methods'], ['2 Methods', 'Methods text.']),
    pg(3, [], ['Results continue without a heading.']),
  ]

  it('accepts the nearest preceding heading inherited across pages', () => {
    // Given a quote on a headingless page 3 whose nearest preceding structural
    // heading is on page 2.
    const result = verifyPaperReview(
      JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [finding('inherited methods', '2 Methods', 3, 'Results continue without a heading.')] }] }),
      supersededPages, PROVIDER, MODEL,
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    const claim = sectionByKind(result.report, 'claims')?.findings[0]
    expect(claim?.source.heading).toBe('2 Methods')
    expect(result.report.gaps.map((g) => g.section)).not.toContain('Claims')
  })

  it('rejects a heading superseded by a later one before the quote', () => {
    // Given the same quote but a heading that an earlier page has already
    // superseded with a later structural heading.
    const result = verifyPaperReview(
      JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [finding('superseded heading', '1 Introduction', 3, 'Results continue without a heading.')] }] }),
      supersededPages, PROVIDER, MODEL,
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    // Then the finding is dropped and a precise citation gap names the section.
    expect(sectionByKind(result.report, 'claims')).toBeUndefined()
    expect(result.report.gaps).toContainEqual({ section: 'Claims', reason: expect.stringContaining('未通过原文出处核验') })
  })

  it('rejects a heading that belongs to a future page', () => {
    // Given a quote on page 1 while the claimed heading only exists on a later page.
    const futurePages: readonly ExtractedPaperPage[] = [
      pg(1, ['1 Introduction'], ['1 Introduction', 'Intro text.']),
      pg(2, ['2 Methods'], ['2 Methods', 'Methods text.']),
    ]
    const result = verifyPaperReview(
      JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [finding('future heading', '2 Methods', 1, 'Intro text.')] }] }),
      futurePages, PROVIDER, MODEL,
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(sectionByKind(result.report, 'claims')).toBeUndefined()
    expect(result.report.gaps.map((g) => g.section)).toContain('Claims')
  })

  it('rejects a heading that is not a structural heading anywhere (fabricated)', () => {
    // Given a valid quote associated with a heading that never appears as a
    // structural heading in the document.
    const result = verifyPaperReview(
      JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [finding('fabricated association', '99 Conclusion', 1, 'Intro text.')] }] }),
      supersededPages, PROVIDER, MODEL,
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(sectionByKind(result.report, 'claims')).toBeUndefined()
    expect(result.report.gaps.map((g) => g.section)).toContain('Claims')
  })
})

describe('verifyPaperReview within-page line order and repeated quote occurrences', () => {
  const midPagePages: readonly ExtractedPaperPage[] = [
    pg(1, ['1 Introduction', '2 Methods'], ['1 Introduction', 'intro text', '2 Methods', 'methods text']),
  ]

  function claimsRaw(heading: string, quote: string): string {
    return JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [finding('positional heading', heading, 1, quote)] }] })
  }

  it('accepts a quote under the structural heading directly above it on the same page', () => {
    const result = verifyPaperReview(claimsRaw('2 Methods', 'methods text'), midPagePages, PROVIDER, MODEL)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(sectionByKind(result.report, 'claims')?.findings[0]?.source.heading).toBe('2 Methods')
  })

  it('rejects a heading that precedes the quote only by position on the same page', () => {
    // Given a quote located after a later heading but attributed to an earlier one.
    const result = verifyPaperReview(claimsRaw('1 Introduction', 'methods text'), midPagePages, PROVIDER, MODEL)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(sectionByKind(result.report, 'claims')).toBeUndefined()
    expect(result.report.gaps.map((g) => g.section)).toContain('Claims')
  })

  it('accepts either heading when a repeated quote occurs under both headings', () => {
    // Given the same literal quote appears once under each of two headings.
    const repeatedPages: readonly ExtractedPaperPage[] = [
      pg(1, ['1 Introduction', '2 Methods'], ['1 Introduction', 'shared line text', '2 Methods', 'shared line text']),
    ]
    const first = verifyPaperReview(claimsRaw('1 Introduction', 'shared line text'), repeatedPages, PROVIDER, MODEL)
    expect(first.success).toBe(true)
    if (!first.success) throw new Error('expected success')
    expect(sectionByKind(first.report, 'claims')?.findings[0]?.source.heading).toBe('1 Introduction')

    const second = verifyPaperReview(claimsRaw('2 Methods', 'shared line text'), repeatedPages, PROVIDER, MODEL)
    expect(second.success).toBe(true)
    if (!second.success) throw new Error('expected success')
    expect(sectionByKind(second.report, 'claims')?.findings[0]?.source.heading).toBe('2 Methods')
  })

  it('keeps a repeated-quote finding grounded and gapped independently', () => {
    // Given two findings on the same page, one under a valid heading and one with
    // a fabricated heading, quoting the same repeated line.
    const repeatedPages: readonly ExtractedPaperPage[] = [
      pg(1, ['1 Introduction', '2 Methods'], ['1 Introduction', 'shared line text', '2 Methods', 'shared line text']),
    ]
    const result = verifyPaperReview(
      JSON.stringify({ sections: [{ kind: 'claims', title: 'Claims', findings: [
        finding('valid one', '1 Introduction', 1, 'shared line text'),
        finding('fabricated one', '99 Conclusion', 1, 'shared line text'),
      ] }] }),
      repeatedPages, PROVIDER, MODEL,
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(statementsOf(result.report, 'claims')).toEqual(['valid one'])
    expect(result.report.gaps).toContainEqual({ section: 'Claims', reason: expect.stringContaining('未通过原文出处核验') })
  })

  it('never invents a heading for an unspecified (empty) quote heading', () => {
    // Given a valid quote with an empty heading on a page that has headings.
    const result = verifyPaperReview(claimsRaw('', 'intro text'), midPagePages, PROVIDER, MODEL)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    const claim = sectionByKind(result.report, 'claims')?.findings[0]
    expect(claim?.source.heading).toBe('')
    expect(result.report.gaps).toContainEqual({ section: 'Claims', reason: expect.stringContaining('未指明所属章节标题') })
  })
})
