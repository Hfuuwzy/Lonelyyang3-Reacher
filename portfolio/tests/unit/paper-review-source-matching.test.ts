import { describe, expect, it } from 'vitest'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import {
  collectStructuralHeadings,
  effectiveHeadingForPage,
  normalizePage,
  normalizeWhitespace,
  previousStructuralHeading,
  quoteLineIndexes,
} from '../../server/utils/paper-review/source-matching'

function pg(readerPage: number, headings: string[], lines: string[]): ExtractedPaperPage {
  return {
    readerPage,
    lines: lines.map((text) => ({ text, isHeading: headings.includes(text) })),
    headings,
    text: lines.join('\n'),
  }
}

describe('normalizeWhitespace', () => {
  it('collapses every whitespace run to a single space and trims', () => {
    expect(normalizeWhitespace('  a\t\n b   c ')).toBe('a b c')
  })
})

describe('normalizePage / quoteLineIndexes', () => {
  it('maps each normalized char back to its source line', () => {
    const page = pg(1, [], ['alpha beta', 'gamma'])
    const normalized = normalizePage(page)
    expect(normalized.text).toBe('alpha beta gamma')
    const alphaPos = normalized.text.indexOf('alpha')
    const gammaPos = normalized.text.indexOf('gamma')
    expect(normalized.lineOfChar[alphaPos]).toBe(0)
    expect(normalized.lineOfChar[gammaPos]).toBe(1)
  })

  it('matches a quote by whitespace collapse and is case-sensitive', () => {
    const page = pg(1, [], ['The Quick brown', 'fox'])
    expect(quoteLineIndexes(page, 'The\t Quick\nbrown fox')).toHaveLength(1)
    expect(quoteLineIndexes(page, 'the quick brown fox')).toHaveLength(0)
  })

  it('returns one line index per repeated occurrence', () => {
    const page = pg(1, [], ['1 Intro', 'shared token', '2 Methods', 'shared token'])
    expect(quoteLineIndexes(page, 'shared token')).toEqual([1, 3])
  })

  it('returns an empty list when the quote is not literally on the page', () => {
    const page = pg(1, [], ['alpha beta'])
    expect(quoteLineIndexes(page, 'not present')).toEqual([])
  })

  it('returns an empty list without looping for an empty or whitespace-only quote', () => {
    const page = pg(1, [], ['alpha beta'])
    expect(quoteLineIndexes(page, '')).toEqual([])
    expect(quoteLineIndexes(page, '   ')).toEqual([])
  })

  it('keeps UTF-16 line mapping aligned when an astral symbol precedes a heading', () => {
    const page = pg(1, ['1 😀 Intro', '2 Methods'], ['1 😀 Intro', 'astral intro text', '2 Methods', 'methods text'])
    const headings = collectStructuralHeadings([page])
    // The emoji is one code point but two UTF-16 units; `indexOf` offsets are
    // UTF-16 based, so a heading after it must not shift off its line.
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 1 })).toBe('1 😀 Intro')
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 3 })).toBe('2 Methods')
    const normalized = normalizePage(page)
    const methodsPos = normalized.text.indexOf('methods text')
    expect(normalized.lineOfChar[methodsPos]).toBe(3)
  })
})

describe('collectStructuralHeadings / previousStructuralHeading', () => {
  const pages: readonly ExtractedPaperPage[] = [
    pg(1, ['1 Introduction'], ['1 Introduction', 'intro text']),
    pg(2, ['2 Methods'], ['2 Methods', 'methods text']),
    pg(3, [], ['continuation text']),
  ]

  it('collects headings in document order with positions', () => {
    expect(collectStructuralHeadings(pages).map((h) => h.text)).toEqual(['1 Introduction', '2 Methods'])
  })

  it('inherits the last preceding heading across pages', () => {
    const headings = collectStructuralHeadings(pages)
    expect(previousStructuralHeading(headings, { readerPage: 3, lineIndex: 0 })).toBe('2 Methods')
  })

  it('is exact about line order within a page', () => {
    const midPage: readonly ExtractedPaperPage[] = [
      pg(1, ['1 Intro', '2 Methods'], ['1 Intro', 'intro text', '2 Methods', 'methods text']),
    ]
    const headings = collectStructuralHeadings(midPage)
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 1 })).toBe('1 Intro')
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 3 })).toBe('2 Methods')
  })

  it('returns undefined before any heading and never a future heading', () => {
    const headings = collectStructuralHeadings(pages)
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 0 })).toBeUndefined()
    expect(previousStructuralHeading(headings, { readerPage: 1, lineIndex: 1 })).toBe('1 Introduction')
  })
})

describe('effectiveHeadingForPage', () => {
  const pages: readonly ExtractedPaperPage[] = [
    pg(1, ['1 Introduction'], ['1 Introduction', 'intro text']),
    pg(2, [], ['continuation of introduction']),
  ]

  it('reports a page that opens with its own heading', () => {
    const headings = collectStructuralHeadings(pages)
    expect(effectiveHeadingForPage(pages, headings, 1)).toBe('1 Introduction')
  })

  it('reports the inherited heading for a continuation page with none of its own', () => {
    const headings = collectStructuralHeadings(pages)
    expect(effectiveHeadingForPage(pages, headings, 2)).toBe('1 Introduction')
  })

  it('reports nothing when no heading precedes the page at all', () => {
    const lone: readonly ExtractedPaperPage[] = [pg(1, [], ['plain opening text'])]
    const headings = collectStructuralHeadings(lone)
    expect(effectiveHeadingForPage(lone, headings, 1)).toBeUndefined()
  })
})