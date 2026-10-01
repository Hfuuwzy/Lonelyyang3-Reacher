import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractPaperPages, type ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { sourceLines } from '../../server/utils/paper-review/source-ledger'
import { paper29Groups, paper29Pages } from '../fixtures/paper-review-29'
import { buildSamplePdf } from '../fixtures/generate-paper-review-sample.mjs'

describe('#29 fixed source PDF', () => {
  it('extracts wrapped and cross-page source without losing captions or excluded text', async () => {
    // Given the independent fixed PDF.
    const bytes = readFileSync(new URL('../fixtures/paper-review-29.pdf', import.meta.url))
    // When the real extractor reads it.
    const result = await extractPaperPages(bytes)
    // Then page boundaries and exact lines survive.
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Fixture extraction failed')
    expect(result.pages[0]?.lines.map(line => line.text)).toEqual([
      '1 Introduction', 'The calibrated system does not increase error',
      'when the temperature is 20 C.', 'A second paragraph crosses the page boundary and',
    ])
    expect(result.pages[1]?.lines.map(line => line.text)).toEqual([
      'continues without losing its negation or numbers: not 30%.', '2 Results',
      'Figure 1. Error decreases by 12% under calibration.',
      'Table 1. Measured accuracy, not predicted accuracy.', 'Method | Accuracy',
      'Calibrated | 92.4%', 'E = m c^2', 'References',
      '[1] Example Author. Calibration. 2024.', 'Appendix',
      'Additional derivations are outside the translation scope.',
    ])
  })

  it('owns exact originals and stable IDs for a complete model grouping', async () => {
    // Given real extracted source and proposed span groups, not model English.
    const pages = await paper29Pages()
    // When the application validates the partition.
    const result = validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages) }))
    // Then multiline and cross-page units retain literal source text.
    expect(result.gaps).toEqual([])
    expect(result.source.units).toHaveLength(10)
    expect(result.source.units[1]?.original).toBe('The calibrated system does not increase error\nwhen the temperature is 20 C.')
    expect(result.source.units[2]?.original).toBe('A second paragraph crosses the page boundary and\ncontinues without losing its negation or numbers: not 30%.')
    expect(result.source.units[8]).toMatchObject({ kind: 'excluded', reason: 'bibliography', headingAnchor: { readerPage: 2, lineIndex: 7, start: 0, end: 10 } })
    expect(new Set(result.source.units.map(unit => unit.id)).size).toBe(10)
    expect(validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages).reverse() })).source).toEqual(result.source)
  })

  it.each(['omitted', 'overlap', 'out-of-range', 'invented-exclusion', 'preserved-prose', 'malformed'])(
    'localizes %s proposals while retaining an exhaustive ledger', async fault => {
      // Given an untrusted proposal claiming full completion.
      const pages = await paper29Pages()
      const groups = paper29Groups(pages)
      switch (fault) {
        case 'omitted': groups.splice(1, 1); break
        case 'overlap': groups.push({ kind: 'paragraph', spans: [{ readerPage: 1, lineIndex: 1, start: 0, end: 10 }] }); break
        case 'out-of-range': groups[1] = { kind: 'paragraph', spans: [{ readerPage: 99, lineIndex: 0, start: 0, end: 10 }] }; break
        case 'invented-exclusion': groups[1] = { ...groups[1], kind: 'excluded', reason: 'appendix' }; break
        case 'preserved-prose': groups[1] = { ...groups[1], kind: 'preserved-original', reason: 'formula' }; break
      }
      // When application validation runs, model status/counts are irrelevant.
      const result = validateSourceInventory(pages, fault === 'malformed' ? '{' : JSON.stringify({ units: groups, status: 'complete', count: 999 }))
      // Then every source character occurs once, and uncertainty is localized.
      expect(result.gaps.length).toBeGreaterThan(0)
      expect(result.source.units.some(unit => unit.kind === 'unresolved')).toBe(true)
      for (const page of pages) for (const [lineIndex, line] of page.lines.entries()) {
        for (let offset = 0; offset < line.text.length; offset++) {
          if (/\s/.test(line.text.charAt(offset))) continue
          const owners = result.source.units.flatMap(unit => unit.spans).filter(span =>
            span.readerPage === page.readerPage && span.lineIndex === lineIndex && span.start <= offset && span.end > offset)
          expect(owners).toHaveLength(1)
        }
      }
      expect(result.gaps.every(gap => gap.origin === 'application')).toBe(true)
    },
  )

  it('flags multi-column geometry without changing extracted citation text', async () => {
    // Given two columns whose runs would otherwise be merged into a single line.
    const extraction = await extractPaperPages(buildSamplePdf([{ lines: [
      { runs: [{ text: 'Left column', x: 72 }, { text: 'Right column', x: 330 }] },
    ] }]))
    if (!extraction.success) throw new Error('Fixture extraction failed')
    // When a model classifies the merged text as a paragraph.
    const result = validateSourceInventory(extraction.pages, JSON.stringify({ units: [{ kind: 'paragraph', spans: [
      { readerPage: 1, lineIndex: 0, start: 0, end: 'Left column Right column'.length },
    ] }] }))
    // Then ambiguity blocks completion, but line text remains usable for citations.
    expect(extraction.pages[0]?.text).toBe('Left column Right column')
    expect(extraction.pages[0]?.textRuns?.length).toBeGreaterThanOrEqual(2)
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: 'layout-ambiguity', readerPages: [1] }))
  })

  it('does not reopen bibliography scope on a numbered reference entry', () => {
    // Given an exact References anchor, a numbered citation, then a recognized body heading.
    const page: ExtractedPaperPage = {
      readerPage: 1,
      lines: [
        { text: 'References', isHeading: false },
        { text: '1. Smith, A. A reference entry (2024).', isHeading: true },
        { text: '2 Methods', isHeading: true },
        { text: 'Body text resumes here.', isHeading: false },
      ],
      headings: ['1. Smith, A. A reference entry (2024).', '2 Methods'],
      text: 'References\n1. Smith, A. A reference entry (2024).\n2 Methods\nBody text resumes here.',
    }

    // When application source lines resolve the bibliography boundary.
    const result = sourceLines([page])

    // Then the citation remains excluded and only the explicit Methods heading reopens body scope.
    expect(result[1]?.exclusion?.reason).toBe('bibliography')
    expect(result[2]?.exclusion).toBeUndefined()
    expect(result[3]?.heading).toBe('2 Methods')
  })

  it.each(['Appendix A', 'Appendices'])('recognizes %s as an anchored appendix heading', (heading) => {
    // Given a standalone appendix heading with following text.
    const page: ExtractedPaperPage = {
      readerPage: 1,
      lines: [
        { text: heading, isHeading: false },
        { text: 'Additional derivations are outside the translation scope.', isHeading: false },
      ],
      headings: [],
      text: `${heading}\nAdditional derivations are outside the translation scope.`,
    }

    // When application source lines resolve the appendix boundary.
    const result = sourceLines([page])

    // Then both anchor and following content remain explicitly excluded as appendix.
    expect(result[0]?.exclusion?.reason).toBe('appendix')
    expect(result[1]?.exclusion?.reason).toBe('appendix')
  })

  it('does not start an exclusion from a prose heading that only mentions references', () => {
    // Given a sentence-like line that mentions references but is not an exact anchor.
    const page: ExtractedPaperPage = {
      readerPage: 1,
      lines: [{ text: 'References and methods are discussed below.', isHeading: false }],
      headings: [],
      text: 'References and methods are discussed below.',
    }

    // When application source lines resolve the document scope.
    const result = sourceLines([page])

    // Then the prose remains in the normal body scope.
    expect(result[0]?.exclusion).toBeUndefined()
  })
})
