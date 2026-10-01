import type { PaperReviewGap, PaperReviewSection } from './paper-review-contract'

function assertNever(value: never): never {
  throw new Error(`unreachable paper-source unit kind: ${String(value)}`)
}

/**
 * True only for source units that carry a Chinese translation in the dossier:
 * paragraphs, headings, and captions. Shared verbatim by the server pipeline
 * and Reader B so the eligibility rule lives in exactly one place.
 */
export function isTranslationEligible(unit: PaperSourceUnit): boolean {
  switch (unit.kind) {
    case 'paragraph':
    case 'heading':
    case 'caption':
      return true
    case 'excluded':
    case 'preserved-original':
    case 'unresolved':
      return false
    default:
      return assertNever(unit)
  }
}

export interface PaperSourceSpan {
  readonly readerPage: number
  readonly lineIndex: number
  readonly start: number
  readonly end: number
}

interface SourceUnitBase {
  readonly id: string
  readonly spans: readonly PaperSourceSpan[]
  readonly original: string
  readonly heading: string
}

export type PaperSourceUnit = SourceUnitBase & (
  | { readonly kind: 'paragraph' | 'heading' }
  | { readonly kind: 'caption'; readonly mediaReaderPages: readonly number[] }
  | { readonly kind: 'excluded'; readonly reason: 'bibliography' | 'appendix'; readonly headingAnchor: PaperSourceSpan }
  | { readonly kind: 'preserved-original'; readonly reason: 'formula' | 'table-content' | 'page-number' }
  | { readonly kind: 'unresolved' }
)

export interface PaperSourceInventory {
  readonly sourceId: string
  readonly pageCount: number
  readonly units: readonly PaperSourceUnit[]
}

export interface PaperTranslationPair {
  readonly unitId: string
  readonly chinese: string | null
}

export interface PaperSourceReview {
  readonly reviewOf: string
  readonly status: 'not-run' | 'incomplete' | 'passed'
  readonly checks: readonly { readonly unitId: string; readonly verdict: 'passed' | 'issues' }[]
}

export interface PaperReviewTaskGap {
  readonly artifact: 'source' | 'report' | 'translation' | 'source-review'
  readonly code: string
  readonly origin: 'application' | 'model-report' | 'model-review'
  readonly unitIds: readonly string[]
  readonly readerPages: readonly number[]
  readonly spans: readonly PaperSourceSpan[]
  readonly reason: string
}

export interface PaperReviewTaskResult {
  readonly status: 'complete' | 'incomplete'
  readonly provider: string
  readonly model: string
  readonly source: PaperSourceInventory
  readonly report: { readonly sections: readonly PaperReviewSection[]; readonly gaps: readonly PaperReviewGap[] } | null
  readonly translation: { readonly pairs: readonly PaperTranslationPair[]; readonly review: PaperSourceReview }
  readonly gaps: readonly PaperReviewTaskGap[]
}
