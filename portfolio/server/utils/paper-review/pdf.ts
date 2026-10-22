import {
  getDocument,
  InvalidPDFException,
  PasswordException,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PaperTextRun } from './source-layout'
import { isPdfHeadingLine, readPage } from './pdf-page'

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

/** A heading candidate is an exact, short, structurally numbered page line. */
export function isHeadingLine(line: string): boolean {
  return isPdfHeadingLine(line)
}

export type PaperExtractionErrorCode =
  | 'empty-input'
  | 'invalid-pdf'
  | 'encrypted'
  | 'no-text'
  | 'read-failed'
  | 'cancelled'

export interface PaperExtractionError {
  readonly code: PaperExtractionErrorCode
  readonly message: string
  readonly recoverable: boolean
}

export interface ExtractedPaperLine {
  readonly text: string
  readonly isHeading: boolean
  /** Rounded baseline y (larger = higher on the page); app reads this for paragraph spacing. */
  readonly baselineY?: number
  /** Column index in x order for a multi-column page, or undefined for full-width. */
  readonly column?: number
  /** True when runs on this baseline overlap, so the reading order is genuinely ambiguous. */
  readonly ambiguous?: boolean
  /** Recognized content kind carried to the candidate layer for preservation. */
  readonly recognized?: 'table' | 'formula' | 'code'
}

export interface ExtractedPaperPage {
  readonly textRuns?: readonly PaperTextRun[]
  /** 1-based reader page number, equal to the argument passed to `getPage`. */
  readonly readerPage: number
  /** The reconstructed visual lines of this page, top to bottom. */
  readonly lines: readonly ExtractedPaperLine[]
  /** Candidate heading lines, each an exact extracted page line. */
  readonly headings: readonly string[]
  /** The full page text, lines joined with newlines. */
  readonly text: string
  /** Media-box width in PDF units, retained for region geometry. */
  readonly pageWidth?: number
  /** Media-box height in PDF units, retained for region geometry. */
  readonly pageHeight?: number
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

/** Fixed, safe, actionable text for a cancelled extraction. */
const PAPER_REVIEW_PDF_CANCELLED_MESSAGE =
  'PDF text extraction was cancelled before it could complete.'

/** A PDF.js loading task surface; the real `PDFDocumentLoadingTask` fits. */
export interface PdfLoadingTask {
  readonly promise: Promise<PDFDocumentProxy>
  destroy(): Promise<void> | void
}

/** Injectable seam that starts a document load; defaults to `getDocument`. */
export type PdfLoader = (bytes: Uint8Array) => PdfLoadingTask

const defaultLoader: PdfLoader = (bytes) => getDocument({ data: new Uint8Array(bytes) })

function cancelledResult(): PaperExtractionFailure {
  return {
    success: false,
    error: { code: 'cancelled', message: PAPER_REVIEW_PDF_CANCELLED_MESSAGE, recoverable: false },
  }
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
    code: 'read-failed',
    message: 'PDF text could not be read because the document failed to load.',
    recoverable: false,
  }
}

const READ_FAILED_ERROR: PaperExtractionError = {
  code: 'read-failed',
  message: 'PDF text extraction failed partway through reading the document.',
  recoverable: false,
}

/**
 * Extract each page's selectable text and candidate heading lines from raw PDF
 * bytes. Returns a discriminated result: a success with 1-based reader pages,
 * or a typed actionable failure.
 */
export async function extractPaperPages(
  bytes: Uint8Array,
  signal?: AbortSignal,
  loader: PdfLoader = defaultLoader,
): Promise<PaperExtractionResult> {
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

  if (signal?.aborted) {
    return cancelledResult()
  }

  let loadingTask: PdfLoadingTask | undefined
  let destroyPromise: Promise<void> | undefined
  let destroyFailed = false
  let aborted = false
  const destroyLoadingTask = (): Promise<void> => {
    const task = loadingTask
    if (task === undefined) {
      return Promise.resolve()
    }
    if (destroyPromise === undefined) {
      try {
        destroyPromise = Promise.resolve(task.destroy()).then(
          () => undefined,
          () => { destroyFailed = true },
        )
      } catch {
        destroyFailed = true
        destroyPromise = Promise.resolve()
      }
    }
    return destroyPromise
  }
  const onAbort = (): void => {
    aborted = true
    void destroyLoadingTask()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
  }

  let result: PaperExtractionResult | undefined
  try {
    if (aborted) {
      result = cancelledResult()
    } else {
      try {
        loadingTask = loader(bytes)
      } catch (error) {
        result = { success: false, error: classifyLoadError(error) }
      }

      if (aborted && result === undefined) {
        result = cancelledResult()
      }

      if (result === undefined && loadingTask !== undefined) {
        let document: PDFDocumentProxy | undefined
        try {
          document = await loadingTask.promise
        } catch (error) {
          result = aborted
            ? cancelledResult()
            : { success: false, error: classifyLoadError(error) }
        }

        if (document !== undefined) {
          if (aborted) {
            result = cancelledResult()
          } else {
            try {
              const pageCount = document.numPages
              const pages: ExtractedPaperPage[] = []
              for (let readerPage = 1; readerPage <= pageCount; readerPage += 1) {
                if (aborted) {
                  result = cancelledResult()
                  break
                }
                pages.push(await readPage(document, readerPage))
              }
              if (result === undefined && aborted) {
                result = cancelledResult()
              } else if (result === undefined && pages.every((page) => page.lines.length === 0)) {
                result = {
                  success: false,
                  error: {
                    code: 'no-text',
                    message:
                      'The PDF has no selectable text; it may be a scanned or image-only document.',
                    recoverable: false,
                  },
                }
              } else if (result === undefined) {
                result = { success: true, pageCount, pages }
              }
            } catch (error) {
              if (aborted) {
                result = cancelledResult()
              } else if (error instanceof Error) {
                result = { success: false, error: READ_FAILED_ERROR }
              } else {
                throw error
              }
            }
          }
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await destroyLoadingTask()
  }

  if (aborted) {
    return cancelledResult()
  }
  if (destroyFailed) {
    return { success: false, error: READ_FAILED_ERROR }
  }
  if (result === undefined) {
    throw new Error('PDF extraction finished without a result.')
  }
  return result
}
