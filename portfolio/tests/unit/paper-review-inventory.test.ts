import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractPaperPages, type ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { buildSourceCandidates } from '../../server/utils/paper-review/source-candidate'
import { sourceLines } from '../../server/utils/paper-review/source-ledger'
import { paper29Pages } from '../fixtures/paper-review-29'
import { buildSamplePdf } from '../fixtures/generate-paper-review-sample.mjs'

/**
 * The classification response a model returns for the fixed #29 PDF: one record
 * per application-owned candidate id, classified at the semantic boundary
 * (kind + optional reason) — never spans, offsets, or new ids.
 */
function paper29Inventory(pages: readonly ExtractedPaperPage[]) {
  return buildSourceCandidates(pages).map((candidate) =>
    candidate.exclusion !== undefined ? { candidateId: candidate.id, kind: 'excluded', reason: candidate.exclusion.reason }
      : candidate.caption ? { candidateId: candidate.id, kind: 'caption' }
      : candidate.preserved !== undefined ? { candidateId: candidate.id, kind: 'preserved-original', reason: candidate.preserved }
      : candidate.headingCandidate ? { candidateId: candidate.id, kind: 'heading' }
      : candidate.ambiguous ? { candidateId: candidate.id, kind: 'unresolved' }
      : { candidateId: candidate.id, kind: 'paragraph' })
}

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

  it('owns exact originals and stable IDs for a complete classification', async () => {
    // Given the application-owned candidates classified correctly, not model English.
    const pages = await paper29Pages()
    // When the application validates the candidate classification and order.
    const result = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    // Then multiline and cross-page units retain literal source text and stable ids.
    expect(result.gaps).toEqual([])
    expect(result.source.units).toHaveLength(10)
    expect(result.source.units[1]?.original).toBe('The calibrated system does not increase error\nwhen the temperature is 20 C.')
    expect(result.source.units[2]?.original).toBe('A second paragraph crosses the page boundary and\ncontinues without losing its negation or numbers: not 30%.')
    expect(result.source.units[8]).toMatchObject({ kind: 'excluded', reason: 'bibliography', headingAnchor: { readerPage: 2, lineIndex: 7, start: 0, end: 10 } })
    expect(new Set(result.source.units.map(unit => unit.id)).size).toBe(10)
    expect(validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages).reverse())).source).toEqual(result.source)
  })

  it.each(['omitted', 'overlap', 'out-of-range', 'invented-exclusion', 'preserved-prose', 'malformed'])(
    'localizes %s classifications while retaining an exhaustive ledger', async fault => {
      // Given an untrusted classification claiming full completion.
      const pages = await paper29Pages()
      const classes = paper29Inventory(pages).map(candidate => ({ ...candidate }))
      switch (fault) {
        case 'omitted': classes.splice(1, 1); break
        case 'overlap': classes.push({ ...classes[1]! }); break
        case 'out-of-range': classes[1] = { ...classes[1]!, candidateId: 'c-unknown-outside' }; break
        case 'invented-exclusion': classes[1] = { ...classes[1]!, kind: 'excluded', reason: 'appendix' }; break
        case 'preserved-prose': classes[1] = { ...classes[1]!, kind: 'preserved-original', reason: 'formula' }; break
      }
      // When application validation runs, model status/counts/spans are irrelevant.
      const result = validateSourceInventory(pages, fault === 'malformed' ? '{' : JSON.stringify(classes))
      // Then uncertainty is localized, prose stays exhaustive, and origin is application.
      expect(result.gaps.length).toBeGreaterThan(0)
      for (const page of pages) for (const [lineIndex, line] of page.lines.entries()) {
        for (let offset = 0; offset < line.text.length; offset++) {
          if (/\s/.test(line.text.charAt(offset))) continue
          const owners = result.source.units.flatMap(unit => unit.spans).filter(span =>
            span.readerPage === page.readerPage && span.lineIndex === lineIndex && span.start <= offset && span.end > offset)
          expect(owners).toHaveLength(1)
        }
      }
      expect(result.gaps.every(gap => gap.origin === 'application')).toBe(true)
      // A readable prose classification the model omits or mislabels stays translation-eligible.
      expect(result.source.units[1]?.kind).toBe('paragraph')
    },
  )

  it('flags ambiguous geometry as unresolved source with a localized gap', async () => {
    // Given a readable line whose runs overlap, so reading order is ambiguous.
    const page: ExtractedPaperPage = {
      readerPage: 1,
      lines: [{ text: 'Overlapping runs text', isHeading: false, ambiguous: true }],
      headings: [],
      text: 'Overlapping runs text',
    }
    // When the model classifies the merged text as prose.
    const candidates = buildSourceCandidates([page])
    const result = validateSourceInventory([page], JSON.stringify(candidates.map(candidate => ({ candidateId: candidate.id, kind: 'paragraph' }))))
    // Then ambiguity blocks completion with a localized unresolved gap.
    expect(result.source.units.some(unit => unit.kind === 'unresolved')).toBe(true)
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: 'unresolved-source', readerPages: [1] }))
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

  it('derives caption media pages from validated source spans', async () => {
    // Given the fixed PDF classified at the candidate boundary (no media pages supplied).
    const pages = await paper29Pages()
    const result = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    // Then caption media pages come from the validated caption spans.
    const caption = result.source.units.find(unit => unit.kind === 'caption' && unit.original.startsWith('Figure'))
    expect(caption).toMatchObject({ kind: 'caption', mediaReaderPages: [2] })
  })

  it('recognizes multi-column geometry via text runs without dropping extracted text', async () => {
    // Given two columns whose runs would otherwise be merged into a single line.
    const extraction = await extractPaperPages(buildSamplePdf([{ lines: [
      { runs: [{ text: 'Left column', x: 72 }, { text: 'Right column', x: 330 }] },
    ] }]))
    if (!extraction.success) throw new Error('Fixture extraction failed')
    // Then line text remains usable for citations and the raw runs survive.
    expect(extraction.pages[0]?.text).toBe('Left column Right column')
    expect(extraction.pages[0]?.textRuns?.length).toBeGreaterThanOrEqual(2)
  })
})