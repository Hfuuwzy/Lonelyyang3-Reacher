import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PAPER_TASK_SOURCE_VIEW_TIMEOUT_MS,
  usePaperTaskSourceMaterials,
  type PaperTaskSourceMaterials,
  type PaperTaskSourceMaterialsTransport,
} from '../../app/composables/paper-task-source-materials'
import type { PaperTaskSourceTaskId } from '../../app/utils/paper-task-source-view'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_TASK_ID = '123e4567-e89b-12d3-a456-426614174001'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
}

interface Harness {
  readonly taskId: Ref<string | null>
  readonly ready: Ref<boolean>
  readonly materials: PaperTaskSourceMaterials
  readonly scope: EffectScope
}

interface Request {
  readonly taskId: PaperTaskSourceTaskId
  readonly signal: AbortSignal
  readonly response: Deferred<unknown>
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((error: Error) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) {
        throw new Error('Request promise was not initialized.')
      }
      resolvePromise(value)
    },
    reject(error) {
      if (rejectPromise === undefined) {
        throw new Error('Request promise was not initialized.')
      }
      rejectPromise(error)
    },
  }
}

function sourceView(taskId: string): Record<string, unknown> {
  return { taskId, state: 'prepared', gaps: [], assets: [] }
}

function createHarness(
  transport: PaperTaskSourceMaterialsTransport,
  initialTaskId: string | null = null,
  initiallyReady = false,
): Harness {
  const taskId = ref(initialTaskId)
  const ready = ref(initiallyReady)
  const scope = effectScope()
  const materials = scope.run(() => usePaperTaskSourceMaterials(taskId, ready, { transport }))
  if (materials === undefined) {
    throw new Error('Source materials controller was not created in its effect scope.')
  }

  return { taskId, ready, materials, scope }
}

function controlledTransport(): {
  readonly transport: PaperTaskSourceMaterialsTransport
  readonly requests: Request[]
} {
  const requests: Request[] = []
  return {
    requests,
    transport(taskId, signal) {
      const response = deferred<unknown>()
      requests.push({ taskId, signal, response })
      return response.promise
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('paper task source materials controller', () => {
  it('fetches once only after a task is ready and adopts its matching view', async () => {
    // Given a task that is not terminal yet.
    const { transport, requests } = controlledTransport()
    const harness = createHarness(transport)
    harness.taskId.value = TASK_ID

    // When the task becomes ready, one source request is started and resolved.
    harness.ready.value = true
    const request = requests[0]
    if (request === undefined) {
      throw new Error('Expected one source request.')
    }
    request.response.resolve(sourceView(TASK_ID))
    await request.response.promise

    // Then only the matching task view is exposed, with no repeat request on readiness changes.
    expect(harness.materials.state.value).toMatchObject({ kind: 'loaded', view: { taskId: TASK_ID } })
    harness.ready.value = false
    harness.ready.value = true
    expect(requests).toHaveLength(1)
    harness.scope.stop()
  })

  it('rejects a response whose task UUID differs from the requested task', async () => {
    // Given a ready task with a pending source response.
    const { transport, requests } = controlledTransport()
    const harness = createHarness(transport, TASK_ID, true)
    const request = requests[0]
    if (request === undefined) {
      throw new Error('Expected one source request.')
    }

    // When the endpoint returns another task's valid view.
    request.response.resolve(sourceView(OTHER_TASK_ID))
    await request.response.promise

    // Then the mismatched materials remain an explicit error, not a success.
    expect(harness.materials.state.value).toEqual({ kind: 'error' })
    harness.scope.stop()
  })

  it('aborts a replaced task and never adopts its late response', async () => {
    // Given an in-flight source request for the first task.
    const { transport, requests } = controlledTransport()
    const harness = createHarness(transport, TASK_ID, true)
    const firstRequest = requests[0]
    if (firstRequest === undefined) {
      throw new Error('Expected the first source request.')
    }

    // When a replacement task becomes current, then the old response resolves late.
    harness.taskId.value = OTHER_TASK_ID
    const secondRequest = requests[1]
    if (secondRequest === undefined) {
      throw new Error('Expected the replacement source request.')
    }
    firstRequest.response.resolve(sourceView(TASK_ID))
    await firstRequest.response.promise

    // Then the first signal is aborted and its source view cannot replace the new task state.
    expect(firstRequest.signal.aborted).toBe(true)
    expect(harness.materials.state.value).toEqual({ kind: 'loading' })
    secondRequest.response.resolve(sourceView(OTHER_TASK_ID))
    await secondRequest.response.promise
    expect(harness.materials.state.value).toMatchObject({ kind: 'loaded', view: { taskId: OTHER_TASK_ID } })
    harness.scope.stop()
  })

  it('aborts on unmount and suppresses a response that arrives afterward', async () => {
    // Given a ready task with an in-flight source request.
    const { transport, requests } = controlledTransport()
    const harness = createHarness(transport, TASK_ID, true)
    const request = requests[0]
    if (request === undefined) {
      throw new Error('Expected one source request.')
    }

    // When the owning scope unmounts before the response arrives.
    harness.scope.stop()
    request.response.resolve(sourceView(TASK_ID))
    await request.response.promise

    // Then the request is aborted and the disposed controller stays empty.
    expect(request.signal.aborted).toBe(true)
    expect(harness.materials.state.value).toEqual({ kind: 'idle' })
  })

  it('keeps a failed source request out of the loaded state', async () => {
    // Given a ready task whose source request fails.
    const { transport, requests } = controlledTransport()
    const harness = createHarness(transport, TASK_ID, true)
    const request = requests[0]
    if (request === undefined) {
      throw new Error('Expected one source request.')
    }

    // When the source endpoint rejects.
    request.response.reject(new Error('source request failed'))
    await request.response.promise.catch(() => undefined)

    // Then no empty or missing source state is presented as a successful view.
    expect(harness.materials.state.value).toEqual({ kind: 'error' })
    harness.scope.stop()
  })

  it('aborts the request and reports error when its bounded timeout expires', async () => {
    // Given a source transport that rejects as soon as its request is aborted.
    vi.useFakeTimers()
    const { transport, requests } = controlledTransport()
    const harness = createHarness((taskId, signal) => {
      signal.addEventListener('abort', () => {
        const request = requests[0]
        request?.response.reject(new Error('request aborted'))
      }, { once: true })
      return transport(taskId, signal)
    }, TASK_ID, true)
    const request = requests[0]
    if (request === undefined) {
      throw new Error('Expected one source request.')
    }

    // When the configured request bound elapses.
    await vi.advanceTimersByTimeAsync(PAPER_TASK_SOURCE_VIEW_TIMEOUT_MS)

    // Then the request is aborted and represented as an error.
    expect(request.signal.aborted).toBe(true)
    expect(harness.materials.state.value).toEqual({ kind: 'error' })
    harness.scope.stop()
  })
})
