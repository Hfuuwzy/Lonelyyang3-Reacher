import { createHash } from 'node:crypto'
import type { PaperSourceSpan, PaperSourceUnit, PaperReviewTaskGap } from '../../../app/utils/paper-review-task-contract'
import type { ExtractedPaperPage } from './pdf'

export interface SourceLine {
  readonly span: PaperSourceSpan
  readonly text: string
  readonly heading: string
  readonly baselineY?: number
  readonly column?: number
  readonly ambiguous?: boolean
  readonly recognized?: 'table' | 'formula' | 'code'
  readonly exclusion?: { readonly reason: 'bibliography' | 'appendix'; readonly headingAnchor: PaperSourceSpan }
}

const EXCLUSION_HEADING = /^(?:\d+(?:\.\d+)*\.?\s+)?(references|bibliography|works cited|appendix(?:\s+[a-z0-9]+)?|appendices)$/i
const BODY_SECTION_HEADING = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:introduction|background|related work|literature review|methods?|methodology|materials and methods|results|discussion|conclusions?|limitations?|acknowledg(?:e)?ments?|data availability|ethics statement|funding|author contributions|conflicts of interest|study design|experiments|findings|analysis)$/i
// A titled appendix subsection ("A Data Statistic", "B Train Details", "B.1
// Pre-training") — accepted only after the bibliography scope has begun, so a
// prose letter in the body never opens appendix scope on its own.
const APPENDIX_HEADING = /^(?:[A-B](?:\.[0-9]+)?\s+[A-Z][A-Za-z -]*)$/

export function sourceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function sourceLines(pages: readonly ExtractedPaperPage[]): readonly SourceLine[] {
  let heading = ''
  let exclusion: SourceLine['exclusion']
  return pages.flatMap(page => page.lines.map((line, lineIndex) => {
    const span = { readerPage: page.readerPage, lineIndex, start: 0, end: line.text.length }
    const text = line.text.trim()
    const anchor = EXCLUSION_HEADING.exec(text)
    if (anchor) {
      const title = anchor[1] ?? ''
      exclusion = { reason: /^appendix(?:\s|$)|^appendices$/i.test(title) ? 'appendix' : 'bibliography', headingAnchor: span }
      heading = line.text
    } else if (exclusion?.reason === 'bibliography' && APPENDIX_HEADING.test(text)) {
      exclusion = { reason: 'appendix', headingAnchor: span }
      heading = line.text
    } else if (exclusion?.reason === 'bibliography' && BODY_SECTION_HEADING.test(text)) {
      heading = line.text
      exclusion = undefined
    } else if (exclusion?.reason === 'appendix' && APPENDIX_HEADING.test(text)) {
      heading = line.text
    } else if (exclusion === undefined && (line.isHeading || BODY_SECTION_HEADING.test(text))) {
      heading = line.text
    }
    return { span, text: line.text, heading, baselineY: line.baselineY, column: line.column, ambiguous: line.ambiguous, recognized: line.recognized, exclusion }
  }))
}

export function spanKey(span: PaperSourceSpan): string {
  return `${span.readerPage}:${span.lineIndex}`
}

export function unitGap(unit: PaperSourceUnit, artifact: PaperReviewTaskGap['artifact'], code: string): PaperReviewTaskGap {
  return {
    artifact, code, origin: 'application', unitIds: [unit.id], spans: unit.spans,
    readerPages: [...new Set(unit.spans.map(span => span.readerPage))],
    reason: `${artifact}: ${code}`,
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${String(value)}`)
}
