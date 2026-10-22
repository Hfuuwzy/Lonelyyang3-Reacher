import type { PaperReviewTaskResult } from './paper-review-task-contract'

/**
 * Adopted paper-review result state for the workbench (issue #29): the exact
 * `File` captured at submission, its display name, and the temporary object
 * URL created from that same file. Pure and browser-agnostic — object-URL
 * creation and revocation are injected so the lifecycle is unit-testable in
 * the node vitest environment.
 *
 * The binding is immutable and captured at creation, so later form selection
 * changes (a new file picked while a result is still adopted) can neither
 * relabel the dossier nor redirect its open/download links to a different
 * object URL. The owner clears the state on replacement submit, reset, and
 * unmount, which revokes the owned URL exactly once.
 */

export type PaperReviewObjectUrlCreator = (file: File) => string
export type PaperReviewObjectUrlRevoker = (url: string) => void

export interface PaperReviewResultState {
  /** The terminal task result driving the dossier. */
  readonly result: PaperReviewTaskResult
  /** Display name of the submitted PDF, captured at submission. */
  readonly pdfName: string
  /** Temporary object URL of the submitted PDF; revoked on clear. */
  readonly pdfUrl: string
}

export function createPaperReviewResultState(
  file: File,
  result: PaperReviewTaskResult,
  createObjectUrl: PaperReviewObjectUrlCreator,
): PaperReviewResultState {
  return {
    result,
    pdfName: file.name === '' ? '论文' : file.name,
    pdfUrl: createObjectUrl(file),
  }
}

/**
 * Revokes the state's owned object URL (when a state is present) and returns
 * null so the owner can assign the cleared slot in one expression.
 */
export function clearPaperReviewResultState(
  state: PaperReviewResultState | null,
  revokeObjectUrl: PaperReviewObjectUrlRevoker,
): null {
  if (state !== null) {
    revokeObjectUrl(state.pdfUrl)
  }
  return null
}