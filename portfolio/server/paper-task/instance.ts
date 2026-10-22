/**
 * Shared dev-only paper-task service instance (issue #40).
 *
 * All three prototype routes must operate on the same in-memory store, so this
 * module owns the single process-wide instance. It is created lazily on first
 * use; the parent dev peer never sees it.
 */

import { createPaperTaskService, type PaperTaskService } from './coordinator'

let sharedService: PaperTaskService | undefined

export function paperTaskService(): PaperTaskService {
  sharedService ??= createPaperTaskService()
  return sharedService
}
