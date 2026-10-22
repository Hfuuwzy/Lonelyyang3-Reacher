import { describe, expect, it } from 'vitest'
import { PAPER_REVIEW_SECTION_KINDS } from '../../app/utils/paper-review-contract'
import { parseEvidenceNotes, synthesizeReport } from '../../server/paper-review-internal/report-notes'
import { buildScopedReportPages } from '../../server/utils/paper-review/report'

const context = {
  pages: [{ readerPage: 1, text: '1 Methods\nObserved result.', headings: ['1 Methods'], lines: [
    { text: '1 Methods', isHeading: true }, { text: 'Observed result.', isHeading: false },
  ] }],
  pageCount: 1,
  headings: [{ readerPage: 1, lineIndex: 0, text: '1 Methods' }],
}

describe('declared report generation gaps', () => {
  it('masks bibliography anchored in the original even when its unit is unresolved', () => {
    const pages = [{ readerPage: 1, headings: [], text: 'References\nA cited paper.', lines: [
      { text: 'References', isHeading: false }, { text: 'A cited paper.', isHeading: false },
    ] }]
    const scoped = buildScopedReportPages(pages, [{ id: 'unresolved-reference', kind: 'unresolved',
      original: pages[0]?.text ?? '', heading: 'References',
      spans: [{ readerPage: 1, lineIndex: 1, start: 0, end: 14 }],
    }])
    expect(scoped[0]?.text).not.toContain('A cited paper.')
  })

  it('retains a declared gap even when every section contains grounded findings', () => {
    const gap = { section: 'methods', reason: 'Some methods were not processed.' }
    const parsed = parseEvidenceNotes(JSON.stringify({
      sections: PAPER_REVIEW_SECTION_KINDS.map(kind => ({ kind, title: kind, findings: [
        { statement: 'An observed result.', source: { heading: '1 Methods', readerPage: 1, quote: 'Observed result.' } },
      ] })), gaps: [gap],
    }), context)
    if (parsed.kind !== 'ok') throw new Error('Expected accepted evidence notes')
    const report = synthesizeReport({
      ...parsed.notes, generationGaps: parsed.notes.gaps, provider: 'fixture', model: 'fixture',
      emptyReaderPages: [], partialBatches: 0,
    })
    expect(report.sections).toHaveLength(5)
    expect(report.gaps).toContainEqual(gap)
  })

  it('rejects malformed declared gaps rather than silently discarding them', () => {
    expect(parseEvidenceNotes(JSON.stringify({ sections: [], gaps: [{ section: 'methods', reason: 42 }] }), context).kind).toBe('unusable')
  })
})
