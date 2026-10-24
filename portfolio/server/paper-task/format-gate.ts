import type { PaperTaskState } from '../../app/utils/paper-task-contract'
import type { PaperTaskReaderDocumentStatus } from '../../app/utils/paper-task-reader-contract'

export const PAPER_TASK_FORMATS = ['markdown', 'pdf'] as const
export type PaperTaskFormat = (typeof PAPER_TASK_FORMATS)[number]
export type PaperTaskFormatStatus = 'preview' | 'needs-confirmation' | 'complete' | 'failed'
export type PaperTaskBranchQualityState = 'preview' | 'needs-confirmation' | 'complete' | 'failed'

export function paperTaskBranchQuality(state: PaperTaskState): PaperTaskBranchQualityState {
  if (state === 'complete') return 'complete'
  if (state === 'needs-confirmation') return 'needs-confirmation'
  if (state === 'failed' || state === 'cancelled' || state === 'interrupted' || state === 'not-selected') return 'failed'
  return 'preview'
}

/** A readable document with unresolved or stale material cannot retain complete quality. */
export function paperTaskDocumentQuality(
  branchQuality: PaperTaskBranchQualityState,
  documentStatus: PaperTaskReaderDocumentStatus,
): PaperTaskBranchQualityState {
  if (branchQuality === 'complete' && documentStatus !== 'complete') {
    return documentStatus === 'preview' ? 'preview' : 'needs-confirmation'
  }
  return branchQuality
}

export interface PaperTaskFormatPageCheck {
  readonly page: number
  readonly status: 'passed' | 'minor' | 'blocked'
  /** What must be visible or intact on this page. */
  readonly expected?: string
  /** What the maintainer actually saw in the final rendered document. */
  readonly observed?: string
  /** Concrete inspection reference or observation, not a build/render receipt. */
  readonly evidence?: string
  readonly reason?: string
}

export interface PaperTaskFormatState {
  readonly format: PaperTaskFormat
  readonly build: 'unbuilt' | 'built' | 'failed'
  /** Inherited branch/master quality; a format can never exceed its master. */
  readonly masterQuality: PaperTaskBranchQualityState
  /** Hash of the approved branch master used to build this artifact. */
  readonly sourceMasterSha256?: string
  /** Hash of the same master recorded in the built artifact metadata. */
  readonly artifactMasterSha256?: string
  readonly expectedPageCount?: number
  readonly pages?: readonly PaperTaskFormatPageCheck[]
  readonly blockers?: readonly string[]
}

export interface PaperTaskFormatEvaluation {
  readonly status: PaperTaskFormatStatus
  readonly issues: readonly string[]
}

const HASH_PATTERN = /^[0-9a-f]{64}$/u

export function evaluateFormatGate(state: PaperTaskFormatState): PaperTaskFormatEvaluation {
  if (state.masterQuality === 'failed' || state.build === 'failed') {
    return { status: 'failed', issues: ['format-or-master-failed'] }
  }

  if (state.build === 'unbuilt') {
    return { status: 'preview', issues: ['format-unbuilt'] }
  }

  if (!isSha256(state.sourceMasterSha256) || !isSha256(state.artifactMasterSha256)
    || state.sourceMasterSha256 !== state.artifactMasterSha256) {
    return { status: 'failed', issues: ['artifact-does-not-match-approved-master'] }
  }

  if (state.masterQuality === 'preview') {
    return { status: 'preview', issues: ['master-preview'] }
  }

  if (state.masterQuality === 'needs-confirmation') {
    return { status: 'needs-confirmation', issues: ['master-needs-confirmation'] }
  }

  const blockers = state.blockers?.filter((blocker) => blocker.trim().length > 0) ?? []
  if (blockers.length > 0) {
    return { status: 'needs-confirmation', issues: ['format-blockers-present'] }
  }

  if (state.format === 'markdown') {
    return { status: 'complete', issues: [] }
  }

  if (!Number.isSafeInteger(state.expectedPageCount) || (state.expectedPageCount ?? 0) <= 0) {
    return { status: 'needs-confirmation', issues: ['page-count-invalid'] }
  }

  const pages = state.pages
  if (pages === undefined || pages.length !== state.expectedPageCount) {
    return { status: 'needs-confirmation', issues: ['page-coverage-incomplete'] }
  }

  const seenPages = new Set<number>()
  for (const page of pages) {
    if (!Number.isSafeInteger(page.page) || page.page < 1 || page.page > state.expectedPageCount
      || seenPages.has(page.page)) {
      return { status: 'needs-confirmation', issues: ['page-coverage-invalid'] }
    }
    if (!nonEmpty(page.expected) || !nonEmpty(page.observed) || !nonEmpty(page.evidence)) {
      return { status: 'needs-confirmation', issues: ['page-inspection-evidence-incomplete'] }
    }
    seenPages.add(page.page)
    if (page.status === 'blocked') {
      return { status: 'needs-confirmation', issues: ['page-check-blocked'] }
    }
  }

  if (seenPages.size !== state.expectedPageCount) {
    return { status: 'needs-confirmation', issues: ['page-coverage-incomplete'] }
  }

  return { status: 'complete', issues: [] }
}

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

function isSha256(value: string | undefined): value is string {
  return value !== undefined && HASH_PATTERN.test(value)
}
