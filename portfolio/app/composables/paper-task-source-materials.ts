import { $fetch } from 'ofetch'
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  paperTaskSourceTaskIdSchema,
  paperTaskSourceViewPath,
  projectPaperTaskSourceView,
  type PaperTaskSourceTaskId,
  type PaperTaskSourceView,
} from '../utils/paper-task-source-view'

export const PAPER_TASK_SOURCE_VIEW_TIMEOUT_MS = 10_000

export type PaperTaskSourceMaterialsState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly view: PaperTaskSourceView }
  | { readonly kind: 'error' }

export type PaperTaskSourceMaterialsTransport = (
  taskId: PaperTaskSourceTaskId,
  signal: AbortSignal,
) => Promise<unknown>

export interface PaperTaskSourceMaterials {
  readonly state: ComputedRef<PaperTaskSourceMaterialsState>
}

export interface PaperTaskSourceMaterialsOptions {
  readonly transport?: PaperTaskSourceMaterialsTransport
}

interface ActiveSourceRequest {
  readonly taskId: PaperTaskSourceTaskId
  readonly controller: AbortController
  readonly timeoutId: ReturnType<typeof setTimeout>
}

function getSourceView(taskId: PaperTaskSourceTaskId, signal: AbortSignal): Promise<unknown> {
  return $fetch<unknown>(paperTaskSourceViewPath(taskId), {
    method: 'GET',
    credentials: 'omit',
    retry: 0,
    signal,
  })
}

export function usePaperTaskSourceMaterials(
  taskId: Readonly<Ref<string | null>>,
  ready: Readonly<Ref<boolean>>,
  options: PaperTaskSourceMaterialsOptions = {},
): PaperTaskSourceMaterials {
  const sourceState = ref<PaperTaskSourceMaterialsState>({ kind: 'idle' })
  const transport = options.transport ?? getSourceView
  let activeRequest: ActiveSourceRequest | null = null
  let requestedTaskId: string | null = null
  let observedTaskId = taskId.value
  let disposed = false

  function abortActiveRequest(): void {
    const request = activeRequest
    activeRequest = null
    if (request !== null) {
      clearTimeout(request.timeoutId)
      request.controller.abort()
    }
  }

  function isCurrentRequest(request: ActiveSourceRequest): boolean {
    return !disposed && activeRequest === request && taskId.value === request.taskId
  }

  async function fetchAndAdopt(request: ActiveSourceRequest): Promise<void> {
    try {
      let payload: unknown
      try {
        payload = await transport(request.taskId, request.controller.signal)
      } catch (error) {
        if (!isCurrentRequest(request)) {
          return
        }
        if (!request.controller.signal.aborted && !(error instanceof Error)) {
          throw error
        }
        sourceState.value = { kind: 'error' }
        return
      }

      if (!isCurrentRequest(request) || request.controller.signal.aborted) {
        return
      }
      const view = projectPaperTaskSourceView(payload, request.taskId)
      sourceState.value = view === null ? { kind: 'error' } : { kind: 'loaded', view }
    } finally {
      clearTimeout(request.timeoutId)
      if (activeRequest === request) {
        activeRequest = null
      }
    }
  }

  watch(
    [taskId, ready],
    ([currentTaskId, isReady]) => {
      if (currentTaskId !== observedTaskId) {
        observedTaskId = currentTaskId
        abortActiveRequest()
        requestedTaskId = null
        sourceState.value = { kind: 'idle' }
      }
      if (!isReady || currentTaskId === null || requestedTaskId === currentTaskId) {
        return
      }

      requestedTaskId = currentTaskId
      const parsedTaskId = paperTaskSourceTaskIdSchema.safeParse(currentTaskId)
      if (!parsedTaskId.success) {
        sourceState.value = { kind: 'error' }
        return
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
        if (!disposed && activeRequest?.controller === controller) {
          sourceState.value = { kind: 'error' }
        }
      }, PAPER_TASK_SOURCE_VIEW_TIMEOUT_MS)
      const request: ActiveSourceRequest = {
        taskId: parsedTaskId.data,
        controller,
        timeoutId,
      }
      activeRequest = request
      sourceState.value = { kind: 'loading' }
      void fetchAndAdopt(request)
    },
    { immediate: true, flush: 'sync' },
  )

  onScopeDispose(() => {
    disposed = true
    abortActiveRequest()
    requestedTaskId = null
    sourceState.value = { kind: 'idle' }
  })

  return { state: computed(() => sourceState.value) }
}
