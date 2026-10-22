import type { ExtractedPaperPage } from './pdf'

/**
 * Source-location matching shared by the report verifier and the prompt builder
 * (issue #27).
 *
 * A finding's non-empty heading is accepted only when it is the *exact nearest
 * preceding structural heading* before a matching quote occurrence in document
 * order (reader page, then line order). This is positional, verbatim
 * association — it is **not** entailment, fuzzy similarity, or "any heading on
 * the page". A heading is inherited from a previous page (continuation) until a
 * later heading supersedes it. Empty headings are treated as unspecified and
 * never invented. Quotes are matched against the cited page by collapsing
 * whitespace only; there is no case folding, no fuzzy match, and no
 * concatenating of non-adjacent text.
 */

/** Whitespace-only normalization: collapse every whitespace run to one space. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A document position, ordered by reader page then line index. */
export interface SourcePosition {
  readonly readerPage: number
  /** 0-based index into the page's `lines` array. */
  readonly lineIndex: number
}

/** A structural heading recorded at its document position. */
export interface StructuralHeading {
  readonly readerPage: number
  readonly lineIndex: number
  readonly text: string
}

/**
 * A page's whitespace-collapsed text plus a char→source-line index, so a quote
 * match can be mapped back to the line that contains it for heading association.
 */
export interface NormalizedPage {
  /** Whitespace collapsed to single spaces, trimmed at both ends. */
  readonly text: string
  /** For each char index of `text`, the 0-based source line index it came from. */
  readonly lineOfChar: readonly number[]
}

/**
 * Collapse a page's text exactly as quotes are normalized, while keeping the
 * line each resulting character came from. Empty lines are skipped and lines
 * are joined with a single space, matching `normalizeWhitespace(page.text)`.
 */
export function normalizePage(page: ExtractedPaperPage): NormalizedPage {
  let text = ''
  const lineOfChar: number[] = []
  for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex += 1) {
    const line = page.lines[lineIndex]?.text ?? ''
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    const collapsed = trimmed.replace(/\s+/g, ' ')
    if (text !== '') {
      text += ' '
      lineOfChar.push(lineIndex)
    }
    // Iterate by UTF-16 code unit (not code point) so `text.length` and the
    // `lineOfChar` index stay aligned with `indexOf` offsets, which are also
    // UTF-16 based. An astral symbol occupies two units; indexing lineOfChar by
    // an astral offset would otherwise shift every later line's heading.
    for (let charIndex = 0; charIndex < collapsed.length; charIndex += 1) {
      text += collapsed[charIndex]
      lineOfChar.push(lineIndex)
    }
  }
  return { text, lineOfChar }
}

/** Structural headings of a set of pages, in document order. */
export function collectStructuralHeadings(
  pages: readonly ExtractedPaperPage[],
): readonly StructuralHeading[] {
  const headings: StructuralHeading[] = []
  for (const page of pages) {
    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex += 1) {
      const line = page.lines[lineIndex]
      if (line?.isHeading) {
        headings.push({ readerPage: page.readerPage, lineIndex, text: line.text.trim() })
      }
    }
  }
  return headings
}

/**
 * The exact nearest structural heading strictly before `pos` in document order,
 * or `undefined` when there is no preceding heading. This is the heading the
 * quote at `pos` belongs to; it may live on the cited page or be inherited from
 * a previous page (continuation) until a later heading supersedes it.
 */
export function previousStructuralHeading(
  headings: readonly StructuralHeading[],
  pos: SourcePosition,
): string | undefined {
  let result: string | undefined
  for (const heading of headings) {
    if (
      heading.readerPage < pos.readerPage ||
      (heading.readerPage === pos.readerPage && heading.lineIndex < pos.lineIndex)
    ) {
      result = heading.text
    } else {
      // Headings are in document order, so the first non-preceding one ends the scan.
      break
    }
  }
  return result
}

function indexOfAll(haystack: string, needle: string): number[] {
  // `indexOf` of an empty needle returns `from` unchanged, so the loop below
  // would never advance and hang forever. An empty/whitespace-only quote is
  // meaningless as a source citation, so treat it as absent.
  if (needle === '') {
    return []
  }
  const positions: number[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) {
      break
    }
    positions.push(index)
    from = index + needle.length
  }
  return positions
}

/**
 * 0-based source line index of every occurrence of `quote` within `page`. The
 * quote is normalized (whitespace collapsed, trimmed) and then matched verbatim
 * and case-sensitively against the whitespace-collapsed page text; an empty
 * result means the quote does not literally appear on the page. Repeated
 * occurrences each carry their own line position so heading association stays
 * correct.
 */
export function quoteLineIndexes(page: ExtractedPaperPage, quote: string): number[] {
  const needle = normalizeWhitespace(quote)
  const normalized = normalizePage(page)
  return indexOfAll(normalized.text, needle).map((start) => normalized.lineOfChar[start] ?? 0)
}

/**
 * The section heading in effect for a page's rendered context. When the page
 * opens with its own structural heading that heading wins; otherwise the
 * nearest preceding structural heading (possibly inherited from a previous
 * page) is shown, so the model knows the section a continuation page belongs to.
 */
export function effectiveHeadingForPage(
  pages: readonly ExtractedPaperPage[],
  headings: readonly StructuralHeading[],
  readerPage: number,
): string | undefined {
  const page = pages.find((candidate) => candidate.readerPage === readerPage)
  const firstLine = page?.lines[0]
  if (firstLine?.isHeading) {
    return firstLine.text.trim()
  }
  return previousStructuralHeading(headings, { readerPage, lineIndex: 0 })
}
