import { $fetch } from 'ofetch'
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  paperTaskTranslationPath,
  projectPaperTaskTranslationView,
  type PaperTaskTranslationView,
} from '../utils/paper-task-translation-contract'

export const PAPER_TASK_TRANSLATION_TIMEOUT_MS = 10_000

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export type PaperTaskTranslationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly view: PaperTaskTranslationView }
  | { readonly kind: 'error' }

export type PaperTaskTranslationTransport = (taskId: string, signal: AbortSignal) => Promise<unknown>

export interface PaperTaskTranslation {
  readonly state: ComputedRef<PaperTaskTranslationState>
  readonly refresh: () => void
}

export interface PaperTaskTranslationOptions {
  readonly transport?: PaperTaskTranslationTransport
}

interface ActiveRequest {
  readonly taskId: string
  readonly controller: AbortController
  readonly timeoutId: ReturnType<typeof setTimeout>
}

function getTranslation(taskId: string, signal: AbortSignal): Promise<unknown> {
  return $fetch<unknown>(paperTaskTranslationPath(taskId), {
    method: 'GET',
    credentials: 'omit',
    retry: 0,
    signal,
  })
}

export function usePaperTaskTranslation(
  taskId: Readonly<Ref<string | null>>,
  ready: Readonly<Ref<boolean>>,
  options: PaperTaskTranslationOptions = {},
): PaperTaskTranslation {
  const state = ref<PaperTaskTranslationState>({ kind: 'idle' })
  const refreshNonce = ref(0)
  const transport = options.transport ?? getTranslation
  let activeRequest: ActiveRequest | null = null
  let requestedTaskId: string | null = null
  let observedTaskId = taskId.value
  let observedNonce = refreshNonce.value
  let disposed = false

  function abortActiveRequest(): void {
    const request = activeRequest
    activeRequest = null
    if (request !== null) {
      clearTimeout(request.timeoutId)
      request.controller.abort()
    }
  }

  function isCurrent(request: ActiveRequest): boolean {
    return !disposed && activeRequest === request && taskId.value === request.taskId
  }

  async function fetchAndAdopt(request: ActiveRequest): Promise<void> {
    try {
      let payload: unknown
      try {
        payload = await transport(request.taskId, request.controller.signal)
      } catch {
        if (isCurrent(request) && !request.controller.signal.aborted) state.value = { kind: 'error' }
        return
      }
      if (!isCurrent(request) || request.controller.signal.aborted) return
      const view = projectPaperTaskTranslationView(payload, request.taskId)
      state.value = view === null ? { kind: 'error' } : { kind: 'loaded', view }
    } finally {
      clearTimeout(request.timeoutId)
      if (activeRequest === request) activeRequest = null
    }
  }

  watch(
    [taskId, ready, refreshNonce],
    ([currentTaskId, isReady, nonce]) => {
      if (currentTaskId !== observedTaskId) {
        observedTaskId = currentTaskId
        abortActiveRequest()
        requestedTaskId = null
        state.value = { kind: 'idle' }
      }
      if (nonce !== observedNonce) {
        observedNonce = nonce
        abortActiveRequest()
        requestedTaskId = null
        state.value = { kind: 'idle' }
      }
      if (!isReady || currentTaskId === null || requestedTaskId === currentTaskId) return
      requestedTaskId = currentTaskId
      if (!TASK_ID_PATTERN.test(currentTaskId)) {
        state.value = { kind: 'error' }
        return
      }
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
        if (!disposed && activeRequest?.controller === controller) state.value = { kind: 'error' }
      }, PAPER_TASK_TRANSLATION_TIMEOUT_MS)
      const request: ActiveRequest = { taskId: currentTaskId, controller, timeoutId }
      activeRequest = request
      state.value = { kind: 'loading' }
      void fetchAndAdopt(request)
    },
    { immediate: true, flush: 'sync' },
  )

  onScopeDispose(() => {
    disposed = true
    abortActiveRequest()
    requestedTaskId = null
    state.value = { kind: 'idle' }
  })

  return {
    state: computed(() => state.value),
    refresh: () => { refreshNonce.value += 1 },
  }
}
