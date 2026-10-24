/**
 * Shared dev-only paper-task service instance (issue #40, #61, #62).
 *
 * Submission, history, reconnect, and result routes operate on one coordinator
 * per process. The coordinator restores its bounded history and source map from
 * project-local task data when created; the parent dev peer never sees it.
 */

import { createPaperTaskService, type PaperTaskService } from './coordinator'

let sharedService: PaperTaskService | undefined

export function paperTaskService(): PaperTaskService {
  sharedService ??= createPaperTaskService()
  return sharedService
}
