/**
 * Private safe-run / outcome mapping for the paper-review Harness runner (issue #27).
 *
 * Lives outside `server/utils` so Nuxt auto-import does not scan it. Owns the
 * fixed, sanitized run/cancel messages and the mapping of an SDK run — or a
 * thrown construction/run failure — to a typed, key-free application result.
 */

import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import type {
  PaperReviewHarnessError,
  PaperReviewHarnessFailure,
  PaperReviewHarnessResult,
} from '../utils/paper-review/harness'

/** Fixed, safe, actionable text for a failed run; never carries SDK/provider detail. */
export const RUN_FAILED_MESSAGE =
  'The model review run failed; please try again later.'

/** Fixed, safe, actionable text for a cancelled run; never carries SDK/provider detail. */
const PAPER_REVIEW_RUN_CANCELLED_MESSAGE =
  'The review was cancelled; the temporary session was removed. Please try again if you still want a review.'

/** Terminal cancellation from an abort/disconnect; never a generic run failure. */
export function cancelledResult(): PaperReviewHarnessFailure {
  return {
    success: false,
    error: { code: 'cancelled', message: PAPER_REVIEW_RUN_CANCELLED_MESSAGE, recoverable: false },
  }
}

/** Map any thrown run/construction failure to a typed, key-free error. */
export function toHarnessError(_error: unknown): PaperReviewHarnessError {
  return { code: 'run-failed', message: RUN_FAILED_MESSAGE, recoverable: true }
}

/**
 * Detect a structurally failed SDK run from its collected session events.
 * A `turn/end` closing with an error/abort reason, or any embedded assistant
 * stream whose terminal finish chunk reports an error/abort, marks the run as
 * failed — even when `finalResponse` still carries valid-looking text.
 */
export function toRunOutcome(
  runResult: Pick<RunResult, 'sessionId' | 'finalResponse' | 'events'>,
): PaperReviewHarnessResult {
  const failed = runResult.events.some((event): boolean => {
    switch (event.type) {
      case 'turn/end': {
        const kind = event.data.reason.kind
        return kind === 'error' || kind === 'aborted'
      }
      case 'assistant/attempt':
      case 'assistant/message': {
        for (const record of event.data.stream) {
          if (record.type === 'chunk' && record.chunk.type === 'finish') {
            const kind = record.chunk.reason.kind
            return kind === 'error' || kind === 'aborted'
          }
        }
        return false
      }
      default:
        return false
    }
  })
  if (failed) {
    return { success: false, error: { code: 'run-failed', message: RUN_FAILED_MESSAGE, recoverable: true } }
  }
  return { success: true, finalResponse: runResult.finalResponse }
}
