/**
 * Shared wire contract for the paper-review prototype.
 *
 * Browser-safe: no DOM, fetch, or Node APIs — only literals, types, and pure
 * type-guard functions. The backend agent imports this exact file to shape its
 * `text/event-stream` payloads, and the frontend imports it to validate every
 * inbound stream event at runtime. Do not drift this file from the issue #27
 * contract: `POST /api/prototype/paper-review`, multipart fields `pdf`,
 * `providerLabel`, `baseUrl`, `protocol`, `model`, `apiKey`.
 */

export const PAPER_REVIEW_STAGES = ['validating', 'extracting', 'analyzing', 'verifying'] as const
export type PaperReviewStage = (typeof PAPER_REVIEW_STAGES)[number]

export const PAPER_REVIEW_SECTION_KINDS = ['claims', 'methods', 'experiments', 'evidence', 'criticism'] as const
export type PaperReviewSectionKind = (typeof PAPER_REVIEW_SECTION_KINDS)[number]

export const PAPER_REVIEW_MISSING_SCOPE = ['full-translation'] as const
export type PaperReviewMissingScope = typeof PAPER_REVIEW_MISSING_SCOPE

export interface PaperReviewSourceLocation {
  readonly heading: string
  readonly readerPage: number
  readonly printedPage?: string
  readonly quote: string
}

export interface PaperReviewFinding {
  readonly statement: string
  readonly source: PaperReviewSourceLocation
}

export interface PaperReviewSection {
  readonly kind: PaperReviewSectionKind
  readonly title: string
  readonly findings: readonly PaperReviewFinding[]
}

export interface PaperReviewGap {
  readonly section: string
  readonly reason: string
}

export interface PaperReviewReport {
  readonly status: 'incomplete'
  readonly provider: string
  readonly model: string
  readonly sections: readonly PaperReviewSection[]
  readonly gaps: readonly PaperReviewGap[]
  readonly missingScope: PaperReviewMissingScope
}

export interface PaperReviewStageEvent {
  readonly type: 'stage'
  readonly stage: PaperReviewStage
}

export interface PaperReviewReportEvent {
  readonly type: 'report'
  readonly report: PaperReviewReport
}

export interface PaperReviewErrorEvent {
  readonly type: 'error'
  readonly stage: PaperReviewStage
  readonly code: string
  readonly message: string
}

export type PaperReviewStreamEvent = PaperReviewStageEvent | PaperReviewReportEvent | PaperReviewErrorEvent

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isPaperReviewStage(value: unknown): value is PaperReviewStage {
  return typeof value === 'string' && PAPER_REVIEW_STAGES.some((stage) => stage === value)
}

function isPaperReviewSectionKind(value: unknown): value is PaperReviewSectionKind {
  return typeof value === 'string' && PAPER_REVIEW_SECTION_KINDS.some((kind) => kind === value)
}

function isPaperReviewMissingScope(value: unknown): value is PaperReviewMissingScope {
  return Array.isArray(value) && value.length === 1 && value[0] === 'full-translation'
}

function isPaperReviewSourceLocation(value: unknown): value is PaperReviewSourceLocation {
  if (!isRecord(value)) {
    return false
  }
  return (
    isString(value.heading)
    && typeof value.readerPage === 'number'
    && Number.isInteger(value.readerPage)
    && value.readerPage >= 1
    && (value.printedPage === undefined || isString(value.printedPage))
    && isString(value.quote)
  )
}

function isPaperReviewFinding(value: unknown): value is PaperReviewFinding {
  if (!isRecord(value)) {
    return false
  }
  return isString(value.statement) && isPaperReviewSourceLocation(value.source)
}

function isPaperReviewSection(value: unknown): value is PaperReviewSection {
  if (!isRecord(value)) {
    return false
  }
  return (
    isPaperReviewSectionKind(value.kind)
    && isString(value.title)
    && Array.isArray(value.findings)
    && value.findings.every(isPaperReviewFinding)
  )
}

function isPaperReviewGap(value: unknown): value is PaperReviewGap {
  if (!isRecord(value)) {
    return false
  }
  return isString(value.section) && isString(value.reason)
}

function isPaperReviewReport(value: unknown): value is PaperReviewReport {
  if (!isRecord(value)) {
    return false
  }
  return (
    value.status === 'incomplete'
    && isString(value.provider)
    && isString(value.model)
    && Array.isArray(value.sections)
    && value.sections.every(isPaperReviewSection)
    && Array.isArray(value.gaps)
    && value.gaps.every(isPaperReviewGap)
    && isPaperReviewMissingScope(value.missingScope)
  )
}

/**
 * Validates an inbound stream event decoded from JSON. Unknown event types,
 * missing required fields, and out-of-domain values are rejected so malformed
 * backend output never reaches the UI as a structured event.
 */
export function isPaperReviewStreamEvent(value: unknown): value is PaperReviewStreamEvent {
  if (!isRecord(value) || !isString(value.type)) {
    return false
  }

  switch (value.type) {
    case 'stage':
      return isPaperReviewStage(value.stage)
    case 'report':
      return isPaperReviewReport(value.report)
    case 'error':
      return isPaperReviewStage(value.stage) && isString(value.code) && isString(value.message)
    default:
      return false
  }
}
