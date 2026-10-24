/**
 * In-memory task handle and shared lifecycle helpers for sample paper tasks
 * (issue #40).
 *
 * A handle owns the stop controller, branch states, and the retained workspace
 * and ephemeral runtime roots. The process-local service retains the handle
 * and its history until the task is explicitly removed or the process exits.
 */

import type { PaperTaskBranches, PaperTaskOutcome, PaperTaskSelection } from '../../app/utils/paper-task-contract'
import { getSelectedBranches } from '../../app/utils/paper-task-contract'
import type { PaperTaskRuntime } from './runtime'
import { rmdirSync } from 'node:fs'

export interface PaperTaskHandle {
  readonly taskId: string
  readonly selection: PaperTaskSelection
  readonly sourceTitle: string
  readonly createdAt: string
  readonly workspaceRoot: string
  readonly runtimeRoot: string
  readonly onChange: () => void
  readonly branches: PaperTaskBranches
  readonly controller: AbortController
  readonly runtimes: Map<string, PaperTaskRuntime>
  readonly runtimeClosures: Map<PaperTaskRuntime, Promise<void>>
  readonly runtimeCleanupFailures: Set<PaperTaskRuntime>
  anyFailed: boolean
  outcome: PaperTaskOutcome | undefined
  cleanupFailed: boolean
  finalized: boolean
  execution: Promise<void> | undefined
  settled: Promise<void>
  settle: () => void
  finalizer: Promise<void> | undefined
}

export function makeHandle(
  taskId: string,
  selection: PaperTaskSelection,
  workspaceRoot: string,
  runtimeRoot: string,
  sourceTitle: string,
  createdAt: string,
  onChange: () => void = () => undefined,
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
    sourceTitle,
    createdAt,
    onChange,
    branches,
    controller,
    runtimes: new Map(),
    runtimeClosures: new Map(),
    runtimeCleanupFailures: new Set(),
    anyFailed: false,
    outcome: undefined,
    cleanupFailed: false,
    finalized: false,
    execution: undefined,
    settled,
    settle,
    finalizer: undefined,
  }
  return handle
}

export function requestStop(handle: PaperTaskHandle): void {
  if (!handle.controller.signal.aborted) {
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
          handle.runtimeCleanupFailures.add(runtime)
        } else {
          handle.runtimeCleanupFailures.delete(runtime)
        }
      } catch {
        handle.cleanupFailed = true
        handle.runtimeCleanupFailures.add(runtime)
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

export function cleanupStatus(handle: PaperTaskHandle): 'clean' | 'failed' {
  return handle.cleanupFailed ? 'failed' : 'clean'
}

export function isNoentError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
