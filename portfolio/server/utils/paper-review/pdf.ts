import {
  getDocument,
  InvalidPDFException,
  PasswordException,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * Page-preserving text extraction for uploaded PDFs (issue #27).
 *
 * - Uses the exact installed `pdfjs-dist@6.3.289`. The `legacy` entrypoint is
 *   required because the modern build is not runnable under Node 24 (it calls
 *   `hashOriginal.toHex` on the WebCrypto digest result).
 * - Text is extracted from `getTextContent()`; no canvas or OCR is involved.
 * - `getPage(readerPage)` is 1-based; every returned page is labelled with the
 *   exact argument passed to `getPage`, never a 0-based index.
 * - Candidate headings are exact extracted page lines selected by a structural
 *   rule; nothing is invented.
 */

export type PaperExtractionErrorCode =
  | 'empty-input'
  | 'invalid-pdf'
  | 'encrypted'
  | 'no-text'
  | 'read-failed'

export interface PaperExtractionError {
  readonly code: PaperExtractionErrorCode
  readonly message: string
  readonly recoverable: boolean
}

export interface ExtractedPaperLine {
  readonly text: string
  readonly isHeading: boolean
}

export interface ExtractedPaperPage {
  /** 1-based reader page number, equal to the argument passed to `getPage`. */
  readonly readerPage: number
  /** The reconstructed visual lines of this page, top to bottom. */
  readonly lines: readonly ExtractedPaperLine[]
  /** Candidate heading lines, each an exact extracted page line. */
  readonly headings: readonly string[]
  /** The full page text, lines joined with newlines. */
  readonly text: string
}

export interface PaperExtractionSuccess {
  readonly success: true
  readonly pageCount: number
  readonly pages: readonly ExtractedPaperPage[]
}

export interface PaperExtractionFailure {
  readonly success: false
  readonly error: PaperExtractionError
}

export type PaperExtractionResult = PaperExtractionSuccess | PaperExtractionFailure

/** Largest line we will consider as a single heading. */
const HEADING_MAX_LENGTH = 80
/** Numbered academic heading, e.g. "1 Introduction", "2.3 Methods". */
const HEADING_PATTERN = /^\d+(\.\d+)*\.?\s+\S/

/** A heading candidate is an exact, short, structurally numbered page line. */
export function isHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) {
    return false
  }
  return HEADING_PATTERN.test(trimmed)
}

/** Structural shape drawn from a page's `getTextContent()` items. */
interface TextRunItem {
  readonly str?: unknown
  readonly width?: unknown
  readonly transform?: readonly unknown[]
}

/** Narrow a `getTextContent()` item to a text run (one carrying a `str`). */
function isTextRun(item: object): item is TextRunItem {
  return 'str' in item && typeof item.str === 'string'
}

interface PlacedRun {
  readonly x: number
  readonly width: number
  readonly text: string
}

/**
 * Reconstruct visual lines from a page's text items. Items carrying a `str`
 * field (text runs) are grouped by vertical position (`transform[5]`, larger y
 * = higher on the page) and joined left-to-right (`transform[4]`) within a
 * line.
 */
function reconstructLines(items: readonly TextRunItem[]): string[] {
  const groups = new Map<number, PlacedRun[]>()
  for (const item of items) {
    const transform = item.transform
    if (typeof item.str !== 'string' || !transform) {
      continue
    }
    const rawY = transform[5]
    const rawX = transform[4]
    if (typeof rawY !== 'number') {
      continue
    }
    const x = typeof rawX === 'number' ? rawX : 0
    const width = typeof item.width === 'number' ? item.width : 0
    const y = Math.round(rawY)
    const placed = [...(groups.get(y) ?? [])]
    placed.push({ x, width, text: item.str })
    groups.set(y, placed)
  }
  const orderedY = [...groups.keys()].sort((a, b) => b - a)
  return orderedY
    .map((y) => {
      const runs = [...(groups.get(y) ?? [])].sort((a, b) => a.x - b.x)
      let line = ''
      for (const [index, run] of runs.entries()) {
        line += run.text
        const next = runs[index + 1]
        // Insert a single space only when the adjacent runs have a real
        // horizontal gap and neither side already supplies whitespace.
        if (
          next !== undefined &&
          next.x - (run.x + run.width) > 0 &&
          !/\s$/.test(run.text) &&
          !/^\s/.test(next.text)
        ) {
          line += ' '
        }
      }
      return line
    })
    .filter((line) => line.trim().length > 0)
}

/** Map a getDocument rejection to a typed, non-leaking load error. */
export function classifyLoadError(error: unknown): PaperExtractionError {
  if (error instanceof PasswordException) {
    return {
      code: 'encrypted',
      message: 'The PDF is encrypted and requires a password.',
      recoverable: false,
    }
  }
  if (error instanceof InvalidPDFException) {
    return {
      code: 'invalid-pdf',
      message: 'The uploaded file is not a readable PDF.',
      recoverable: false,
    }
  }
  return {
    code: 'invalid-pdf',
    message: 'The uploaded file is not a readable PDF.',
    recoverable: false,
  }
}

const READ_FAILED_ERROR: PaperExtractionError = {
  code: 'read-failed',
  message: 'PDF text extraction failed partway through reading the document.',
  recoverable: false,
}

/** Release the document and its worker after use. */
async function dispose(document: PDFDocumentProxy): Promise<void> {
  await document.loadingTask.destroy()
}

async function readPage(document: PDFDocumentProxy, readerPage: number): Promise<ExtractedPaperPage> {
  const page = await document.getPage(readerPage)
  const content = await page.getTextContent()
  const runs: TextRunItem[] = []
  for (const item of content.items) {
    if (isTextRun(item)) {
      runs.push(item)
    }
  }
  const lines = reconstructLines(runs)
  return {
    readerPage,
    lines: lines.map((text) => ({ text, isHeading: isHeadingLine(text) })),
    headings: lines.filter(isHeadingLine),
    text: lines.join('\n'),
  }
}

/**
 * Extract each page's selectable text and candidate heading lines from raw PDF
 * bytes. Returns a discriminated result: a success with 1-based reader pages,
 * or a typed actionable failure.
 */
export async function extractPaperPages(bytes: Uint8Array): Promise<PaperExtractionResult> {
  if (bytes.length === 0) {
    return {
      success: false,
      error: {
        code: 'empty-input',
        message: 'No PDF bytes were provided.',
        recoverable: true,
      },
    }
  }

  let document: PDFDocumentProxy
  try {
    document = await getDocument({ data: bytes }).promise
  } catch (error) {
    return { success: false, error: classifyLoadError(error) }
  }

  try {
    const pageCount = document.numPages
    const pages: ExtractedPaperPage[] = []
    // `readerPage` is the exact 1-based argument passed to getPage.
    for (let readerPage = 1; readerPage <= pageCount; readerPage += 1) {
      pages.push(await readPage(document, readerPage))
    }
    if (pages.every((page) => page.lines.length === 0)) {
      return {
        success: false,
        error: {
          code: 'no-text',
          message:
            'The PDF has no selectable text; it may be a scanned or image-only document.',
          recoverable: false,
        },
      }
    }
    return { success: true, pageCount, pages }
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: READ_FAILED_ERROR }
    }
    throw error
  } finally {
    await dispose(document)
  }
}
