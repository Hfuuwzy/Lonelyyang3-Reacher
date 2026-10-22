import type { ExtractedPaperPage } from './pdf'
import type { PaperSourceSpan } from '../../../app/utils/paper-review-task-contract'
import { sourceDigest, sourceLines, type SourceLine } from './source-ledger'

/**
 * Application-owned candidate spans (issue #29 reconstruction).
 *
 * The application decides candidates, grouping, exact originals, spans, IDs,
 * and reading order; the inventory model only classifies candidate IDs. A
 * candidate is a contiguous run of reading-ordered lines covering every
 * non-whitespace source character exactly once. Each candidate carries the
 * application's structural evidence (exclusion anchor, caption, preserved
 * content, heading candidate) so classification never invents spans or merges.
 *
 * Every candidate — prose or structural — is finally partitioned into bounded
 * serialized records (about one model prompt record each) before IDs are
 * assigned, so an oversized bibliography/table block never ships as a single
 * huge unit. Child records keep the parent's structural role flags and the same
 * exclusion anchor.
 */

/** A single source unit should serialize to no more than this many chars. */
export const MAX_CANDIDATE_SERIALIZED_CHARS = 1900
/** Serialized JSON envelope overhead per `{id,text}` record. */
const RECORD_ENVELOPE = 64
/** A vertical gap larger than this on one baseline page breaks a paragraph. */
export const PARAGRAPH_BREAK_SPACING = 40

export type PreservedReason = 'formula' | 'table-content' | 'page-number'
export type ExclusionReason = 'bibliography' | 'appendix'

export interface PaperSourceCandidate {
  readonly id: string
  readonly spans: readonly PaperSourceSpan[]
  /** Exact original text, lines joined with newlines. */
  readonly text: string
  /** Application-owned bibliography/appendix scope from an exact anchor. */
  readonly exclusion?: { readonly reason: ExclusionReason; readonly headingAnchor: PaperSourceSpan }
  /** Application-owned caption span (exact Figure/Table line). */
  readonly caption: boolean
  /** Structural evidence of preserved (non-translatable) content. */
  readonly preserved?: PreservedReason
  /** Structural numbered heading or a typographic full-width title/heading. */
  readonly headingCandidate: boolean
  /** True when an underlying baseline's runs overlap, locking this to unresolved. */
  readonly ambiguous: boolean
}

const CAPTION_PATTERN = /^(?:Figure|Fig\.|Table)\s+\d+[.:]/i
const SENTENCE_END = /[.!?]\s*$/
const FORMULA_PATTERN = /^[\d\sA-Za-z_+\-*/^=().,{}\\]+$/
const KEYWORD_LABEL = /^[A-Za-z][\w -]*:/

function isCaption(text: string): boolean {
  return CAPTION_PATTERN.test(text.trim())
}

function preservedReason(text: string, recognized?: SourceLine['recognized']): PreservedReason | undefined {
  if (recognized === 'table') return 'table-content'
  if (recognized === 'formula') return 'formula'
  const trimmed = text.trim()
  if (/^\s*\d+\s*$/.test(trimmed)) {
    return 'page-number'
  }
  if (trimmed.includes('|') && !/[=\u223c\u2208\u2211]/u.test(trimmed)) {
    return 'table-content'
  }
  if (FORMULA_PATTERN.test(trimmed) && trimmed.includes('=') && !/[A-Za-z]{4,}/.test(trimmed)) {
    return 'formula'
  }
  const expressionStart = /^(?:(?:min|max|log|sum)\b|[A-Za-z\p{Script=Greek}][\w\p{M}\u02c6]*(?:\([^)]*\))?\s*[=\u223c\u2208])/u
  const words = trimmed.match(/[A-Za-z]{4,}/g) ?? []
  if (expressionStart.test(trimmed) && /[=\u223c\u2208\u2211]/u.test(trimmed)
    && words.every(word => word === 'REPLACE' || word === 'MASK' || word === 'unif')) {
    return 'formula'
  }
  return undefined
}

/** A structural heading is an exact ledger heading line (numbered or body-section). */
function isStructuralHeading(line: SourceLine): boolean {
  return line.heading === line.text && line.text.trim().length > 0
}

/** A full-width short line that is not sentence-like and not a keyword label. */
function isTitleLike(line: SourceLine): boolean {
  const text = line.text.trim()
  if (line.column !== undefined || text.length === 0 || text.length > 80) {
    return false
  }
  return !SENTENCE_END.test(text) && !KEYWORD_LABEL.test(text)
}

function samePage(a: SourceLine, b: SourceLine): boolean {
  return a.span.readerPage === b.span.readerPage
}

function verticalGap(a: SourceLine, b: SourceLine): number | undefined {
  if (a.baselineY === undefined || b.baselineY === undefined) {
    return undefined
  }
  return Math.abs(a.baselineY - b.baselineY)
}

/** A title-like line is a heading when it opens the document or is followed by a break. */
function isTypographicHeading(index: number, ledger: readonly SourceLine[]): boolean {
  const line = ledger[index]!
  if (!isTitleLike(line)) {
    return false
  }
  if (index === 0) {
    return true
  }
  const next = ledger[index + 1]
  if (next === undefined) {
    return true
  }
  if (samePage(line, next)) {
    const gap = verticalGap(line, next)
    if (gap !== undefined && gap > PARAGRAPH_BREAK_SPACING) {
      return true
    }
  }
  return isStructuralHeading(next) || isCaption(next.text) || preservedReason(next.text, next.recognized) !== undefined
}

interface OpenCandidate {
  readonly spans: readonly PaperSourceSpan[]
  readonly texts: readonly string[]
  readonly exclusion?: { readonly reason: ExclusionReason; readonly headingAnchor: PaperSourceSpan }
  readonly caption: boolean
  readonly preserved?: PreservedReason
  readonly headingCandidate: boolean
  readonly ambiguous: boolean
  readonly lastSentenceEnded: boolean
  readonly lastLine: SourceLine | undefined
  readonly lastHeading: string
}

function candidateId(spans: readonly PaperSourceSpan[]): string {
  return `c-${sourceDigest(spans).slice(0, 20)}`
}

function makeCandidate(open: OpenCandidate): PaperSourceCandidate {
  return {
    id: candidateId(open.spans),
    spans: open.spans,
    text: open.texts.join('\n'),
    ...(open.exclusion === undefined ? {} : { exclusion: open.exclusion }),
    caption: open.caption,
    ...(open.preserved === undefined ? {} : { preserved: open.preserved }),
    headingCandidate: open.headingCandidate,
    ambiguous: open.ambiguous,
  }
}

function childCandidate(parent: PaperSourceCandidate, spans: readonly PaperSourceSpan[], texts: readonly string[]): PaperSourceCandidate {
  return {
    id: candidateId(spans),
    spans,
    text: texts.join('\n'),
    ...(parent.exclusion === undefined ? {} : { exclusion: parent.exclusion }),
    caption: parent.caption,
    ...(parent.preserved === undefined ? {} : { preserved: parent.preserved }),
    headingCandidate: parent.headingCandidate,
    ambiguous: parent.ambiguous,
  }
}

/**
 * Split one oversized line (its whole span) into UTF-16-offset sub-spans, each
 * bounded to the serialized cap. Offsets are computed by code unit so a
 * candidate's `text` and its spans stay exactly aligned (cover every char once).
 */
function splitOversizedLine(line: SourceLine, parent: PaperSourceCandidate): Array<{ readonly span: PaperSourceSpan; readonly text: string }> {
  const text = line.text
  const charBudget = MAX_CANDIDATE_SERIALIZED_CHARS - RECORD_ENVELOPE
  const pieces: Array<{ readonly span: PaperSourceSpan; readonly text: string }> = []
  let start = 0
  while (start < text.length) {
    // Find the largest end within budget, preferring a whitespace boundary.
    let end = Math.min(start + charBudget, text.length)
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end)
      if (boundary > start) {
        end = boundary
      }
    }
    end = endOfPreviousUnit(text, start, end)
    // Trim the budget so the serialized record stays under the cap.
    const pieceLength = (stop: number): number => JSON.stringify(childCandidate(parent, [{
      ...line.span, start: line.span.start + start, end: line.span.start + stop,
    }], [text.slice(start, stop)])).length
    while (end > start && pieceLength(end) > MAX_CANDIDATE_SERIALIZED_CHARS) {
      end = endOfPreviousUnit(text, start, end - 1)
    }
    if (end <= start) {
      end = start + 1
    }
    pieces.push({
      span: { readerPage: line.span.readerPage, lineIndex: line.span.lineIndex, start: line.span.start + start, end: line.span.start + end },
      text: text.slice(start, end),
    })
    start = end
  }
  return pieces
}

/** Back a UTF-16 cursor up by one code unit so it never points into a surrogate. */
function endOfPreviousUnit(text: string, from: number, cursor: number): number {
  let c = cursor
  while (c > from) {
    const code = text.charCodeAt(c)
    if (code >= 0xdc00 && code <= 0xdfff) {
      c -= 1
      continue
    }
    return c
  }
  return from
}

/**
 * Uniformly partition every candidate (prose or structural) into bounded,
 * reading-ordered records. Each record covers a contiguous run of the parent's
 * spans and keeps the parent's role flags and (for excluded scope) the exact
 * same exclusion anchor. A single line longer than the cap is split at UTF-16
 * offsets so no serialized record exceeds the bound.
 */
function partitionCandidate(candidate: PaperSourceCandidate): PaperSourceCandidate[] {
  const lines = candidate.text.split('\n')
  if (lines.length !== candidate.spans.length) {
    return [candidate]
  }
  const pairs = candidate.spans.map((span, index) => ({ span, text: lines[index] ?? '' }))
  if (JSON.stringify(candidate).length <= MAX_CANDIDATE_SERIALIZED_CHARS) {
    return [candidate]
  }

  const result: PaperSourceCandidate[] = []
  let batchSpans: PaperSourceSpan[] = []
  let batchTexts: string[] = []
  const flush = (): void => {
    if (batchSpans.length > 0) {
      result.push(childCandidate(candidate, batchSpans, batchTexts))
      batchSpans = []
      batchTexts = []
    }
  }
  const pushPair = (span: PaperSourceSpan, text: string): void => {
    batchSpans.push(span)
    batchTexts.push(text)
  }

  for (const pair of pairs) {
    if (JSON.stringify(childCandidate(candidate, [...batchSpans, pair.span], [...batchTexts, pair.text])).length <= MAX_CANDIDATE_SERIALIZED_CHARS) {
      pushPair(pair.span, pair.text)
      continue
    }
    flush()
    if (JSON.stringify(childCandidate(candidate, [pair.span], [pair.text])).length <= MAX_CANDIDATE_SERIALIZED_CHARS) {
      pushPair(pair.span, pair.text)
      continue
    }
    // The single line is itself oversized: split it by UTF-16 offsets.
    const sourceLine: SourceLine = {
      span: pair.span,
      text: pair.text,
      heading: '',
    }
    for (const piece of splitOversizedLine(sourceLine, candidate)) {
      result.push(childCandidate(candidate, [piece.span], [piece.text]))
    }
  }
  flush()
  return result
}

function openFor(line: SourceLine, headingCandidate: boolean): OpenCandidate {
  const caption = isCaption(line.text)
  const preserved = caption ? undefined : preservedReason(line.text, line.recognized)
  return {
    spans: [line.span],
    texts: [line.text],
    ...(line.exclusion === undefined ? {} : { exclusion: line.exclusion }),
    caption,
    ...(preserved === undefined ? {} : { preserved }),
    headingCandidate: headingCandidate && line.exclusion === undefined && !caption && preserved === undefined && !line.ambiguous,
    ambiguous: line.ambiguous === true || line.recognized === 'code',
    lastSentenceEnded: SENTENCE_END.test(line.text),
    lastLine: line,
    lastHeading: line.heading,
  }
}

function sameAnchor(a: PaperSourceSpan, b: PaperSourceSpan): boolean {
  return a.readerPage === b.readerPage && a.lineIndex === b.lineIndex
}

/** True when two ledger lines occupy the same region, so a paragraph may span them. */
function compatibleRegion(a: SourceLine, b: SourceLine): boolean {
  return (a.column ?? -1) === (b.column ?? -1)
}

/** True when a prose line continues the open paragraph (wrap or cross-page). */
function paragraphContinues(line: SourceLine, open: OpenCandidate): boolean {
  if (open.lastSentenceEnded) {
    return false
  }
  const lastSpan = open.spans[open.spans.length - 1]
  if (lastSpan === undefined || line.span.readerPage !== lastSpan.readerPage) {
    return true
  }
  const last = open.lastLine
  if (last !== undefined) {
    if (!compatibleRegion(last, line)) {
      return false
    }
    const gap = verticalGap(last, line)
    if (gap !== undefined) {
      return gap <= PARAGRAPH_BREAK_SPACING
    }
  }
  return true
}

/**
 * Build the exhaustive, reading-ordered candidate spans for a set of pages.
 * Every non-whitespace character is owned by exactly one candidate, and every
 * candidate (structural or not) is finally partitioned into bounded records.
 */
export function buildSourceCandidates(pages: readonly ExtractedPaperPage[]): readonly PaperSourceCandidate[] {
  const ledger = sourceLines(pages)
  const result: PaperSourceCandidate[] = []
  let open: OpenCandidate | undefined

  const close = (): void => {
    if (open === undefined) {
      return
    }
    result.push(...partitionCandidate(makeCandidate(open)))
    open = undefined
  }

  for (let index = 0; index < ledger.length; index += 1) {
    const line = ledger[index]!
    const exclusion = line.exclusion
    const caption = exclusion === undefined && isCaption(line.text)
    const preserved = exclusion === undefined && !caption ? preservedReason(line.text, line.recognized) : undefined
    const headingCandidate = isStructuralHeading(line) || isTypographicHeading(index, ledger)

    if (open !== undefined && open.headingCandidate && headingCandidate) {
      // A heading is its own candidate: an incoming heading closes the previous.
      close()
    }

    if (open !== undefined) {
      const sameRole =
        open.headingCandidate
          ? false
          : open.exclusion !== undefined
            ? exclusion !== undefined && open.exclusion.reason === exclusion.reason && sameAnchor(open.exclusion.headingAnchor, exclusion.headingAnchor)
            : open.caption
              ? caption && sameAnchor(open.spans[0]!, line.span)
              : open.preserved !== undefined
                ? preserved === open.preserved
                 : exclusion === undefined && !caption && preserved === undefined && !headingCandidate
                   && (line.ambiguous === true || line.recognized === 'code') === open.ambiguous
                   && line.heading === open.lastHeading && paragraphContinues(line, open)
      if (!sameRole) {
        close()
      }
    }

    if (open === undefined) {
      open = openFor(line, headingCandidate)
      continue
    }

    open = {
      ...open,
      spans: [...open.spans, line.span],
      texts: [...open.texts, line.text],
      ambiguous: open.ambiguous || line.ambiguous === true,
      lastSentenceEnded: SENTENCE_END.test(line.text),
      lastLine: line,
      lastHeading: line.heading,
    }
  }
  close()
  return result
}
