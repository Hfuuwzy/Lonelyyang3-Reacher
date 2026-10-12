/**
 * In-memory task handle and shared lifecycle helpers for sample paper tasks
 * (issue #40).
 *
 * A handle owns the stop controller, branch states, and the retained workspace
 * and ephemeral runtime roots. Handles exist only while a task is current —
 * there is no history, list, replay, or recovery.
 */

import type { PaperTaskBranches, PaperTaskSelection } from '../../app/utils/paper-task-contract'
import { getSelectedBranches } from '../../app/utils/paper-task-contract'
import type { PaperTaskRuntime } from './runtime'
import { rmdirSync } from 'node:fs'

export interface PaperTaskHandle {
  readonly taskId: string
  readonly selection: PaperTaskSelection
  readonly workspaceRoot: string
  readonly runtimeRoot: string
  readonly branches: PaperTaskBranches
  readonly controller: AbortController
  readonly runtimes: Map<string, PaperTaskRuntime>
  readonly runtimeClosures: Map<PaperTaskRuntime, Promise<void>>
  stopReason: 'cancel' | 'disconnect' | undefined
  anyFailed: boolean
  cleanupFailed: boolean
  finalized: boolean
  /** True once the event stream starts executing; controls cancel/remove waits. */
  started: boolean
  settled: Promise<void>
  settle: () => void
  finalizer: Promise<void> | undefined
}

export function makeHandle(
  taskId: string,
  selection: PaperTaskSelection,
  workspaceRoot: string,
  runtimeRoot: string,
  requestSignal: AbortSignal | undefined,
): PaperTaskHandle {
  let settle = (): void => undefined
  const settled = new Promise<void>((resolveSettle) => {
    settle = resolveSettle
  })
  const controller = new AbortController()
  const branches: PaperTaskBranches = { translation: 'not-selected', 'deep-reading': 'not-selected' }
  for (const branch of getSelectedBranches(selection)) {
    branches[branch] = 'pending'
  }
  const handle: PaperTaskHandle = {
    taskId,
    selection,
    workspaceRoot,
    runtimeRoot,
    branches,
    controller,
    runtimes: new Map(),
    runtimeClosures: new Map(),
    stopReason: undefined,
    anyFailed: false,
    cleanupFailed: false,
    finalized: false,
    started: false,
    settled,
    settle,
    finalizer: undefined,
  }
  if (requestSignal !== undefined) {
    if (requestSignal.aborted) {
      requestStop(handle, 'disconnect')
    } else {
      requestSignal.addEventListener('abort', () => requestStop(handle, 'disconnect'), { once: true })
    }
  }
  return handle
}

export function requestStop(handle: PaperTaskHandle, reason: 'cancel' | 'disconnect'): void {
  if (!handle.controller.signal.aborted) {
    handle.stopReason = reason
    handle.controller.abort()
  }
}

export async function stopAllRuntimes(handle: PaperTaskHandle): Promise<void> {
  await Promise.all([...handle.runtimes.values()].map((runtime) => closeRuntime(handle, runtime)))
}

export function closeRuntime(handle: PaperTaskHandle, runtime: PaperTaskRuntime): Promise<void> {
  let closing = handle.runtimeClosures.get(runtime)
  if (closing === undefined) {
    closing = (async () => {
      try {
        if (!(await runtime.close()).ok) {
          handle.cleanupFailed = true
        }
      } catch {
        handle.cleanupFailed = true
      }
    })()
    handle.runtimeClosures.set(runtime, closing)
  }
  return closing
}

export function finalizeHandle(handle: PaperTaskHandle, runners: readonly Promise<void>[] = []): Promise<void> {
  handle.finalizer ??= (async () => {
    try {
      await stopAllRuntimes(handle)
      await Promise.allSettled(runners)
      try {
        rmdirSync(handle.runtimeRoot)
      } catch (error) {
        if (!isNoentError(error)) {
          handle.cleanupFailed = true
        }
      }
    } finally {
      handle.finalized = true
      handle.settle()
    }
  })()
  return handle.finalizer
}

export function stopOutcome(handle: PaperTaskHandle): 'cancelled' | 'disconnected' {
  return handle.stopReason === 'disconnect' ? 'disconnected' : 'cancelled'
}

export function cleanupStatus(handle: PaperTaskHandle): 'clean' | 'failed' {
  return handle.cleanupFailed ? 'failed' : 'clean'
}

export function isNoentError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
