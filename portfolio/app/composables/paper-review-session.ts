/**
 * Per-parent transient session for the paper-review reader routes: the adopted
 * task result plus the PDF object URL it owns, provided by the parent
 * `paper-review.vue` route and injected by its children (workbench, report,
 * translation) so the PDF URL and result survive child navigation.
 *
 * Session contract:
 * - The parent owns the state; no module singleton, browser history, storage,
 *   or credentials ever enter it — credentials stay in the workbench child.
 * - `adopt` replaces the previous state and revokes its object URL exactly once.
 * - `clear` revokes the owned URL; called on workbench reset, and by the parent
 *   on replacement, unmount, and `pagehide`.
 * - Object-URL creation and revocation are injected so the lifecycle is
 *   unit-testable in the node vitest environment.
 */

import { computed, inject, provide, ref } from 'vue'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import {
  clearPaperReviewResultState,
  createPaperReviewResultState,
} from '../utils/paper-review-result-state'
import type { PaperReviewResultState } from '../utils/paper-review-result-state'
import type { PaperReviewTaskResult } from '../utils/paper-review-task-contract'

export interface PaperReviewObjectUrlAdapter {
  readonly create: (file: File) => string
  readonly revoke: (url: string) => void
}

export interface PaperReviewSession {
  readonly adopted: Readonly<Ref<PaperReviewResultState | null>>
  readonly result: Readonly<ComputedRef<PaperReviewTaskResult | null>>
  readonly pdfUrl: Readonly<ComputedRef<string | null>>
  readonly pdfName: Readonly<ComputedRef<string>>
  readonly adopt: (result: PaperReviewTaskResult, file: File) => void
  readonly clear: () => void
}

export const PAPER_REVIEW_SESSION_KEY: InjectionKey<PaperReviewSession> = Symbol('paper-review-session')

/** Builds the session state holder; creation/revocation of object URLs is injected. */
export function createPaperReviewSession(adapter: PaperReviewObjectUrlAdapter): PaperReviewSession {
  const adopted = ref<PaperReviewResultState | null>(null)
  return {
    adopted,
    result: computed(() => adopted.value?.result ?? null),
    pdfUrl: computed(() => adopted.value?.pdfUrl ?? null),
    pdfName: computed(() => adopted.value?.pdfName ?? '论文'),
    adopt(result, file) {
      const next = createPaperReviewResultState(file, result, adapter.create)
      const previous = adopted.value
      adopted.value = next
      if (previous !== null) {
        adapter.revoke(previous.pdfUrl)
      }
    },
    clear() {
      adopted.value = clearPaperReviewResultState(adopted.value, adapter.revoke)
    },
  }
}

/** Parent-route wiring: provides the session with the real browser URL adapter. */
export function providePaperReviewSession(): PaperReviewSession {
  const session = createPaperReviewSession({
    create: (file) => URL.createObjectURL(file),
    revoke: (url) => URL.revokeObjectURL(url),
  })
  provide(PAPER_REVIEW_SESSION_KEY, session)
  return session
}

/** Child-route access; returns null when the page was opened outside the parent. */
export function usePaperReviewSession(): PaperReviewSession | null {
  return inject(PAPER_REVIEW_SESSION_KEY, null)
}