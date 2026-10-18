import { $fetch } from 'ofetch'
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  paperTaskReaderPath,
  projectPaperTaskReaderView,
  type PaperTaskReaderView,
} from '../utils/paper-task-reader-contract'

export const PAPER_TASK_READER_TIMEOUT_MS = 10_000

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export type PaperTaskReaderState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly view: PaperTaskReaderView }
  | { readonly kind: 'error' }

export type PaperTaskReaderTransport = (taskId: string, signal: AbortSignal) => Promise<unknown>

export interface PaperTaskReader {
  readonly state: ComputedRef<PaperTaskReaderState>
  readonly refresh: () => void
}

export interface PaperTaskReaderOptions {
  readonly transport?: PaperTaskReaderTransport
}

interface ActiveRequest {
  readonly taskId: string
  readonly controller: AbortController
  readonly timeoutId: ReturnType<typeof setTimeout>
}

function getReader(taskId: string, signal: AbortSignal): Promise<unknown> {
  return $fetch<unknown>(paperTaskReaderPath(taskId), {
    method: 'GET',
    credentials: 'omit',
    retry: 0,
    signal,
  })
}

/**
 * Fetches the combined C-focused-reader view when a task reaches its result
 * phase. A response for another task, a malformed view, a timeout, or an
 * unmount never replaces the displayed reader.
 */
export function usePaperTaskReader(
  taskId: Readonly<Ref<string | null>>,
  ready: Readonly<Ref<boolean>>,
  options: PaperTaskReaderOptions = {},
): PaperTaskReader {
  const state = ref<PaperTaskReaderState>({ kind: 'idle' })
  const refreshNonce = ref(0)
  const transport = options.transport ?? getReader
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
      const view = projectPaperTaskReaderView(payload, request.taskId)
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
      }, PAPER_TASK_READER_TIMEOUT_MS)
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
