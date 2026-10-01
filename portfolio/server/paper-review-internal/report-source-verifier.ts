import type { ExtractedPaperPage } from '../utils/paper-review/pdf'
import {
  previousStructuralHeading,
  quoteLineIndexes,
  type StructuralHeading,
} from '../utils/paper-review/source-matching'
import type { PaperReviewSourceLocation } from '../../app/utils/paper-review-contract'

/**
 * Report-specific source citation verification for the paper-review prototype
 * (issue #27). A finding's cited source is verified against the extracted PDF
 * pages: the 1-based reader page must exist in the document, the quoted text
 * must literally appear, and a non-empty heading must be the exact nearest
 * preceding structural heading at a quote occurrence. This lives outside
 * `server/utils` so Nuxt auto-import does not scan it; only the report module
 * consumes it.
 */

function findPage(
  pages: readonly ExtractedPaperPage[],
  readerPage: number,
): ExtractedPaperPage | undefined {
  return pages.find((page) => page.readerPage === readerPage)
}

/** A reader page is only valid as a 1-based integer inside the document. */
function isUsablePage(readerPage: number, pageCount: number): boolean {
  return Number.isInteger(readerPage) && readerPage >= 1 && readerPage <= pageCount
}

export interface VerifiedSource {
  readonly grounded: boolean
  /** Present only when the printed label independently matched an exact line. */
  readonly printedPage?: string
  /** True when the printed label was provided but could not be verified. */
  readonly printedDropped: boolean
  /** True when the quote matched but the model supplied no structural heading. */
  readonly headingUnlocated: boolean
}

export interface ReportSourceContext {
  /** The extracted PDF pages a citation can be grounded against. */
  readonly pages: readonly ExtractedPaperPage[]
  /** The document page count; a reader page must be a 1-based integer within it. */
  readonly pageCount: number
  /** Structural headings in document order, used to match a heading position. */
  readonly headings: readonly StructuralHeading[]
}

/**
 * Verifies a single finding's cited source against the extracted pages. Returns
 * `grounded:false` when the citation cannot be grounded at all (the finding is
 * dropped); otherwise returns the grounded source, dropping an unverifiable
 * printed label and flagging an explicitly unlocated structural heading.
 */
export function verifyPaperReviewSource(
  source: PaperReviewSourceLocation,
  context: ReportSourceContext,
): VerifiedSource {
  if (!isUsablePage(source.readerPage, context.pageCount)) {
    return { grounded: false, printedDropped: false, headingUnlocated: false }
  }
  const page = findPage(context.pages, source.readerPage)
  if (page === undefined) {
    return { grounded: false, printedDropped: false, headingUnlocated: false }
  }
  const occurrences = quoteLineIndexes(page, source.quote)
  if (occurrences.length === 0) {
    return { grounded: false, printedDropped: false, headingUnlocated: false }
  }

  let headingUnlocated = false
  if (source.heading.trim() === '') {
    // An empty heading is accepted (never invented) but recorded as unlocated.
    headingUnlocated = true
  } else {
    // A non-empty heading must be the exact nearest preceding structural heading
    // at one of the quote's literal occurrences; future/fabricated/superseded
    // headings are rejected. Repeated occurrences each associate independently.
    const matched = occurrences.some(
      (lineIndex) =>
        previousStructuralHeading(context.headings, {
          readerPage: source.readerPage,
          lineIndex,
        }) === source.heading.trim(),
    )
    if (!matched) {
      return { grounded: false, printedDropped: false, headingUnlocated: false }
    }
  }

  const printed = source.printedPage
  if (printed === undefined) {
    return { grounded: true, printedDropped: false, headingUnlocated }
  }
  if (!page.lines.some((line) => line.text === printed)) {
    return { grounded: true, printedDropped: true, headingUnlocated }
  }
  return { grounded: true, printedPage: printed, printedDropped: false, headingUnlocated }
}