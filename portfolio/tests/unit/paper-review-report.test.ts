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

const pages: readonly ExtractedPaperPage[] = [
  pg(1, ['1 Introduction'], ['1 Introduction', 'The quick brown fox jumps over the lazy dog.', 'p. 1']),
  pg(2, ['2 Methods'], ['2 Methods', 'Sample sizes were determined a priori.']),
  pg(3, ['3 Results'], ['3 Results', 'Accuracy improved from 71.2% to 92.4% after tuning.']),
]

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

function allSectionsRaw(): string {
  return raw(
    { kind: 'claims', title: 'Claims', findings: [finding('The method introduces the study context.', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.')] },
    { kind: 'methods', title: 'Methods', findings: [finding('Sample sizes were fixed up front.', '2 Methods', 2, 'Sample sizes were determined a priori.')] },
    { kind: 'experiments', title: 'Experiments', findings: [finding('Accuracy rose sharply after tuning.', '3 Results', 3, 'Accuracy improved from 71.2% to 92.4% after tuning.')] },
    { kind: 'evidence', title: 'Evidence', findings: [finding('The results support the improvement claim.', '3 Results', 3, 'Accuracy improved from 71.2% to 92.4% after tuning.')] },
    { kind: 'criticism', title: 'Criticism', findings: [finding('The introduction is critique context.', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.')] },
  )
}

function build(rawPayload: string): PaperReviewReport {
  const result = verifyPaperReview(rawPayload, pages, PROVIDER, MODEL)
  expect(result.success).toBe(true)
  if (!result.success) {
    throw new Error('expected a successful report but got a failure')
  }
  return result.report
}

function sectionByKind(report: PaperReviewReport, kind: string): PaperReviewReport['sections'][number] | undefined {
  return report.sections.find((section) => section.kind === kind)
}

function statementsOf(report: PaperReviewReport, kind: string): string[] {
  return (sectionByKind(report, kind)?.findings ?? []).map((f) => f.statement)
}

describe('verifyPaperReview happy paths', () => {
  it('accepts all five required sections with valid exact citations', () => {
    // Given a response covering all five kinds with exact-cited findings.
    const report = build(allSectionsRaw())
    // Then all five sections are present in canonical order with no gaps.
    expect(report.sections.map((s) => s.kind)).toEqual(['claims', 'methods', 'experiments', 'evidence', 'criticism'])
    expect(report.gaps).toEqual([])
    expect(report.status).toBe('incomplete')
    expect(report.missingScope).toEqual(['full-translation'])
  })

  it('echoes the provided provider and model, never from the model blob', () => {
    const report = build(allSectionsRaw())
    expect(report.provider).toBe(PROVIDER)
    expect(report.model).toBe(MODEL)
  })

  it('retains a valid exact quote, page, and heading verbatim', () => {
    const claim = sectionByKind(build(allSectionsRaw()), 'claims')?.findings[0]
    expect(claim?.statement).toBe('The method introduces the study context.')
    expect(claim?.source.heading).toBe('1 Introduction')
    expect(claim?.source.readerPage).toBe(1)
    expect(claim?.source.quote).toBe('The quick brown fox jumps over the lazy dog.')
  })

  it('accepts a quote that differs only in whitespace from the extracted page', () => {
    // Given a statement quoting a line with odd spacing and line breaks.
    const report = build(raw({ kind: 'evidence', title: 'Evidence', findings: [finding('whitespace variant', '1 Introduction', 1, '  The\t quick\nbrown fox jumps   over\nthe lazy dog. ')] }))
    // Then the quote is retained (no evidence gap); other kinds are missing gaps.
    expect(report.gaps.map((g) => g.section)).not.toContain('Evidence')
    expect(sectionByKind(report, 'evidence')?.findings).toHaveLength(1)
  })

  it('never marks a report complete', () => {
    const report = build(allSectionsRaw())
    expect(report.status).toBe('incomplete')
    expect(report.missingScope).toEqual(['full-translation'])
  })

  it('preserves model-reported coverage gaps with their affected scope', () => {
    // Given a grounded report that identifies an uncovered source range.
    const response = JSON.stringify({
      sections: [
        {
          kind: 'claims',
          title: 'Claims',
          findings: [finding('The paper states its main claim.', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.')],
        },
      ],
      gaps: [{ section: 'Appendix', reason: 'The appendix text is outside this review.' }],
    })

    // When the response is verified.
    const report = build(response)

    // Then the affected scope remains visible alongside system gaps.
    expect(report.gaps).toContainEqual({ section: 'Appendix', reason: 'The appendix text is outside this review.' })
  })

  it('adds a source gap for pages with no selectable text', () => {
    // Given a readable document with one image-only reader page.
    const mixedPages = [...pages, pg(4, [], [])]

    // When the report is verified against all extracted pages.
    const result = verifyPaperReview(allSectionsRaw(), mixedPages, PROVIDER, MODEL)

    // Then the image-only page range is explicitly identified as uncovered.
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.report.gaps).toContainEqual({
        section: 'PDF source',
        reason: 'PDF 阅读页 4 没有可选择文本，本次未进行 OCR。',
      })
    }
  })
})

describe('verifyPaperReview whole-response rejection', () => {
  it('rejects a non-JSON response with a typed error', () => {
    const result = verifyPaperReview('not json at all', pages, PROVIDER, MODEL)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('malformed-json')
      expect(result.error.message.length).toBeGreaterThan(0)
    }
  })

  it('rejects a response missing the sections array', () => {
    const result = verifyPaperReview(JSON.stringify({ foo: 1 }), pages, PROVIDER, MODEL)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('malformed-report')
    }
  })

  it('rejects sections that are not an array', () => {
    const result = verifyPaperReview(JSON.stringify({ sections: 'nope' }), pages, PROVIDER, MODEL)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('malformed-report')
    }
  })
})

describe('verifyPaperReview converts invalid citations into gaps', () => {
  it.each([
    { name: 'zero-based reader page', page: 0, quote: 'The quick brown fox jumps over the lazy dog.', heading: '1 Introduction' },
    { name: 'out-of-range reader page', page: 999, quote: 'The quick brown fox jumps over the lazy dog.', heading: '1 Introduction' },
    { name: 'wrong-page quote', page: 2, quote: 'The quick brown fox jumps over the lazy dog.', heading: '1 Introduction' },
    { name: 'fabricated heading', page: 1, quote: 'The quick brown fox jumps over the lazy dog.', heading: '99 Conclusion' },
    { name: 'invented quote', page: 1, quote: 'No such sentence exists anywhere.', heading: '1 Introduction' },
  ])('turns $name into a gap instead of emitting it', ({ page, quote, heading }) => {
    // Given a claims finding whose citation cannot be grounded on the cited page.
    const report = build(raw({ kind: 'claims', title: 'Claims', findings: [finding('must be dropped', heading, page, quote)] }))
    // Then the finding is dropped and a gap names the affected section.
    expect(statementsOf(report, 'claims')).toEqual([])
    expect(sectionByKind(report, 'claims')).toBeUndefined()
    expect(report.gaps.map((g) => g.section)).toContain('Claims')
  })

  it('keeps grounded findings while gapping only the ungrounded ones in one section', () => {
    // Given a claims section with one grounded and one fabricated finding.
    const report = build(raw({ kind: 'claims', title: 'Claims', findings: [
      finding('This finding is grounded.', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.'),
      finding('This finding is fabricated and must be dropped.', '1 Introduction', 1, 'No such sentence exists anywhere.'),
    ] }))
    // Then only the grounded finding is emitted, and a gap records the dropped one.
    expect(statementsOf(report, 'claims')).toEqual(['This finding is grounded.'])
    expect(report.sections).toHaveLength(1)
    expect(report.gaps.map((g) => g.section)).toContain('Claims')
  })
})

describe('verifyPaperReview missing section handling', () => {
  it('adds a gap for a required section kind missing from the response', () => {
    // Given a valid response that omits the criticism section entirely.
    const report = build(raw(
      { kind: 'claims', title: 'Claims', findings: [finding('a', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.')] },
      { kind: 'methods', title: 'Methods', findings: [finding('b', '2 Methods', 2, 'Sample sizes were determined a priori.')] },
      { kind: 'experiments', title: 'Experiments', findings: [finding('c', '3 Results', 3, 'Accuracy improved from 71.2% to 92.4% after tuning.')] },
      { kind: 'evidence', title: 'Evidence', findings: [finding('d', '3 Results', 3, 'Accuracy improved from 71.2% to 92.4% after tuning.')] },
    ))
    // Then criticism is absent from sections but named as a gap.
    expect(sectionByKind(report, 'criticism')).toBeUndefined()
    expect(report.sections.map((s) => s.kind)).toEqual(['claims', 'methods', 'experiments', 'evidence'])
    expect(report.gaps.map((g) => g.section)).toContain('Criticism')
  })
})

describe('verifyPaperReview printed page handling', () => {
  it('omits the printed label and adds a gap when it is not an extracted line', () => {
    const report = build(raw({ kind: 'evidence', title: 'Evidence', findings: [finding('printed label is not a line', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.', 'p. 99')] }))
    const evidence = sectionByKind(report, 'evidence')
    expect(evidence?.findings).toHaveLength(1)
    expect(evidence?.findings[0]?.source.printedPage).toBeUndefined()
    expect(report.gaps.map((g) => g.section)).toContain('Evidence')
  })

  it('retains the printed label when it is an exact extracted line', () => {
    const report = build(raw({ kind: 'evidence', title: 'Evidence', findings: [finding('printed label is an exact line', '1 Introduction', 1, 'The quick brown fox jumps over the lazy dog.', 'p. 1')] }))
    const evidence = sectionByKind(report, 'evidence')
    expect(evidence?.findings[0]?.source.printedPage).toBe('p. 1')
    expect(report.gaps.map((g) => g.section)).not.toContain('Evidence')
  })

  it('keeps the finding even when only the printed label is unverifiable', () => {
    const report = build(raw({ kind: 'criticism', title: 'Criticism', findings: [finding('critique survives a bad printed label', '2 Methods', 2, 'Sample sizes were determined a priori.', 'not a line')] }))
    const criticism = sectionByKind(report, 'criticism')
    expect(criticism?.findings).toHaveLength(1)
    expect(criticism?.findings[0]?.source.readerPage).toBe(2)
    expect(criticism?.findings[0]?.source.printedPage).toBeUndefined()
    expect(report.gaps.map((g) => g.section)).toContain('Criticism')
  })
})
