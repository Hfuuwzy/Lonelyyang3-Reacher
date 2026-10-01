import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  InvalidPDFException,
  PasswordException,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  classifyLoadError,
  extractPaperPages,
  isHeadingLine,
  type ExtractedPaperPage,
} from '../../server/utils/paper-review/pdf'
import type { PdfLoader } from '../../server/utils/paper-review/pdf'
import { buildSamplePdf } from '../fixtures/generate-paper-review-sample.mjs'

// Fresh bytes every call: pdfjs may transfer the typed array to its worker.
function fixtureBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL('../fixtures/paper-review-sample.pdf', import.meta.url)),
  )
}

const EXPECTED_LINES: Record<number, readonly string[]> = {
  1: [
    '1 Introduction',
    'Portable Document Format files preserve layout for print.',
    'This synthetic fixture is not a real academic paper.',
    'The quick brown fox jumps over the lazy dog.',
    'Precomputed baselines anchor the expected extraction values.',
  ],
  2: [
    '2 Methods',
    'We measured response latency with a calibrated timer.',
    'Sample sizes were determined a priori.',
    'Each trial ran in full isolation from prior trials.',
  ],
  3: [
    '3 Results',
    'Accuracy improved from 71.2% to 92.4% after tuning.',
    'A shorter quote spans the sentence boundary.',
  ],
}

const EXPECTED_HEADINGS: Record<number, readonly string[]> = {
  1: ['1 Introduction'],
  2: ['2 Methods'],
  3: ['3 Results'],
}

const KNOWN_QUOTES: Record<number, string> = {
  1: 'The quick brown fox jumps over the lazy dog.',
  2: 'Sample sizes were determined a priori.',
  3: 'Accuracy improved from 71.2% to 92.4% after tuning.',
}

async function successPages(): Promise<readonly ExtractedPaperPage[]> {
  const result = await extractPaperPages(fixtureBytes())
  expect(result.success).toBe(true)
  if (!result.success) {
    throw new Error('fixture extraction unexpectedly failed')
  }
  return result.pages
}

describe('extractPaperPages happiness path', () => {
  it('returns one independent 1-based readerPage per extracted page', async () => {
    // Given a three-page fixture.
    // When the PDF is extracted.
    const pages = await successPages()

    // Then there are three pages labelled with the exact getPage argument.
    expect(pages.map((page) => page.readerPage)).toEqual([1, 2, 3])
  })

  it('labels readerPage with the 1-based value actually passed to getPage', async () => {
    // When the fixture is extracted.
    const pages = await successPages()

    // Then every readerPage is a positive integer starting at 1, never 0-based.
    pages.forEach((page) => {
      expect(Number.isInteger(page.readerPage)).toBe(true)
      expect(page.readerPage).toBeGreaterThanOrEqual(1)
    })
    expect(pages.find((page) => page.readerPage === 1)?.readerPage).toBe(1)
  })

  it('extracts the exact known text lines per page', async () => {
    // When the fixture is extracted.
    const pages = await successPages()

    // Then each page's lines match the hand-written literal line arrays.
    pages.forEach((page) => {
      expect(page.lines.map((line) => line.text)).toEqual([...(EXPECTED_LINES[page.readerPage] ?? [])])
    })
  })

  it('reports candidate headings as exact extracted page lines per page', async () => {
    // When the fixture is extracted.
    const pages = await successPages()

    // Then each page has its numbered heading and every heading is a real line.
    pages.forEach((page) => {
      expect(page.headings).toEqual([...(EXPECTED_HEADINGS[page.readerPage] ?? [])])
      for (const heading of page.headings) {
        expect(page.lines.map((line) => line.text)).toContain(heading)
      }
    })
  })

  it('keeps each known quote verbatim on its own page', async () => {
    // When the fixture is extracted.
    const pages = await successPages()

    // Then each known quote appears exactly on its expected page.
    pages.forEach((page) => {
      expect(page.text).toContain(KNOWN_QUOTES[page.readerPage])
    })
  })

  it('preserves page boundaries (no cross-page leakage)', async () => {
    // When the fixture is extracted.
    const pages = await successPages()

    // Then each page's text stays isolated from the others' quotes and headings.
    const textOf = (readerPage: number): string =>
      pages.find((page) => page.readerPage === readerPage)?.text ?? ''
    expect(textOf(1)).not.toContain('a priori')
    expect(textOf(1)).not.toContain('92.4%')
    expect(textOf(2)).not.toContain('lazy dog')
    expect(textOf(2)).not.toContain('1 Introduction')
    expect(textOf(3)).not.toContain('lazy dog')
    expect(textOf(3)).not.toContain('2 Methods')
  })

  it('inserts a word separator between adjacent positioned text runs', async () => {
    // Given two PDF text runs separated by a visible horizontal word gap.
    const bytes = buildSamplePdf([
      { lines: [{ runs: [{ text: 'Alpha', x: 72 }, { text: 'Beta', x: 116 }] }] },
    ])

    // When the PDF is extracted.
    const result = await extractPaperPages(bytes)

    // Then the source words remain distinct on their original reader page.
    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.pages.find((page) => page.readerPage === 1)?.text).toBe('Alpha Beta')
  })

  it('extracts a Node Buffer byte input as produced by H3 multipart parsing', async () => {
    // Given the fixture loaded as a raw Node Buffer (the shape multipart parts
    // carry at runtime — a Buffer subclass, not a plain Uint8Array).
    const bytes = readFileSync(new URL('../fixtures/paper-review-sample.pdf', import.meta.url))

    // When the Buffer input is extracted.
    const result = await extractPaperPages(bytes)

    // Then all three pages are extracted successfully rather than being
    // mislabelled as an invalid PDF by the pdfjs Buffer guard.
    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.pages.map((page) => page.readerPage)).toEqual([1, 2, 3])
  })
})

describe('extractPaperPages rejection path', () => {
  it('rejects an empty byte input with a typed actionable error', async () => {
    // Given zero bytes.
    const result = await extractPaperPages(new Uint8Array(0))

    // Then a typed empty-input failure is returned.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('empty-input')
    expect(result.error.recoverable).toBe(true)
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('rejects a corrupt (non-PDF) byte input', async () => {
    // Given bytes that are not a PDF.
    const result = await extractPaperPages(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))

    // Then a typed invalid-pdf failure is returned.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('invalid-pdf')
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('rejects a truncated (corrupt) PDF', async () => {
    // Given the leading bytes of a real PDF cut short mid-header.
    const result = await extractPaperPages(fixtureBytes().slice(0, 64))

    // When the truncated bytes are extracted.
    // Then a typed invalid-pdf failure is returned.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('invalid-pdf')
  })

  it('rejects a scanned/no-text PDF with a typed no-text error', async () => {
    // Given a valid PDF whose only page has no selectable text.
    const result = await extractPaperPages(buildSamplePdf([{ lines: [] }]))

    // When it is extracted.
    // Then a typed no-text failure is returned.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('no-text')
  })

  it('maps a PasswordException to the encrypted error code', () => {
    // Given a pdfjs PasswordException.
    const classified = classifyLoadError(new PasswordException('need password', 1))

    // When it is classified.
    // Then the encrypted code is returned without leaking the message.
    expect(classified.code).toBe('encrypted')
    expect(classified.message).not.toContain('need password')
  })

  it('maps an InvalidPDFException to the invalid-pdf error code', () => {
    const classified = classifyLoadError(new InvalidPDFException('bad pdf'))
    expect(classified.code).toBe('invalid-pdf')
  })

  it('maps unknown operational load errors to a safe read-failed error', () => {
    const classified = classifyLoadError(new Error('mystery internals'))
    expect(classified.code).toBe('read-failed')
    expect(classified.message).not.toContain('mystery')
  })
})

describe('extractPaperPages cancellation (issue #28)', () => {
  it('returns an identifiable cancelled result for a pre-aborted signal without loading', async () => {
    // Given a pre-aborted signal.
    const controller = new AbortController()
    controller.abort()
    // When extracted with the pre-aborted signal.
    const result = await extractPaperPages(fixtureBytes(), controller.signal, () => {
      throw new Error('a pre-aborted extraction must not load the PDF')
    })

    // Then a terminal cancelled result is returned and no document was loaded.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cancelled')
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('aborting during load disposes the loading task and returns cancelled', async () => {
    // Given a signal aborted while the PDF worker is still loading the document.
    const controller = new AbortController()
    let rejectLoad: (error: Error) => void = () => {
      throw new Error('the PDF load promise was not initialized')
    }
    let destroyCalls = 0
    const loader: PdfLoader = () => ({
      promise: new Promise<PDFDocumentProxy>((_resolve, reject) => {
        rejectLoad = (error) => reject(error)
      }),
      destroy: () => {
        destroyCalls += 1
        rejectLoad(new Error('PDF load destroyed'))
      },
    })

    // When extraction is started and aborted before the load can resolve.
    const pending = extractPaperPages(fixtureBytes(), controller.signal, loader)
    controller.abort()
    const result = await pending

    // Then the outcome is a terminal cancelled result and no pages escaped.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cancelled')
    expect(destroyCalls).toBe(1)
  })
})

describe('isHeadingLine', () => {
  it('accepts short numbered academic headings', () => {
    expect(isHeadingLine('1 Introduction')).toBe(true)
    expect(isHeadingLine('2.3 Methods')).toBe(true)
    expect(isHeadingLine('10. Results and Discussion')).toBe(true)
  })

  it('rejects body text, empty lines, and over-long lines', () => {
    expect(isHeadingLine('The quick brown fox jumps over the lazy dog.')).toBe(false)
    expect(isHeadingLine('')).toBe(false)
    expect(
      isHeadingLine(
        'A line that is far too long to ever be a heading because it keeps going and going beyond the configured maximum length for a heading candidate',
      ),
    ).toBe(false)
  })
})
