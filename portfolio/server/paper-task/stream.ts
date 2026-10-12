import { join } from 'node:path'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import {
  getSelectedBranches,
  type PaperTaskBranch,
  type PaperTaskBranches,
  type PaperTaskEvent,
  type PaperTaskOutcome,
} from '../../app/utils/paper-task-contract'
import type { PaperTaskMultipartInput } from './multipart'
import { saveWorkContext, workspacePaths } from './workspace'
import type { PaperTaskRuntimeFactory } from './runtime'
import { cleanupStatus, finalizeHandle, requestStop, stopOutcome, type PaperTaskHandle } from './handle'
import { EventQueue, takeOrAbort } from './queue'
import type { createPaperTaskSourceStore } from './source-store'
import { runPaperTaskBranch } from './branch-stream'

export type PreparePaperTaskSource = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperTaskSourceResult>

export function createTaskEvents(
  handle: PaperTaskHandle,
  input: PaperTaskMultipartInput,
  runtimeFactory: PaperTaskRuntimeFactory,
  prepareSource: PreparePaperTaskSource,
  sourceStore: ReturnType<typeof createPaperTaskSourceStore>,
): AsyncIterable<PaperTaskEvent> {
  const queue = new EventQueue<{ readonly kind: 'event'; readonly event: PaperTaskEvent }>()
  const branchQueue = new EventQueue()
  const runners: Array<Promise<void>> = []
  let producer: Promise<void> | undefined
  let suppressTerminal = false

  const start = (): void => {
    if (producer !== undefined) {
      return
    }
    handle.started = true
    producer = produceTask(handle, input, runtimeFactory, prepareSource, sourceStore, queue, branchQueue, runners, () => suppressTerminal)
  }

  return {
    [Symbol.asyncIterator]() {
      let terminalRead = false
      return {
        async next(): Promise<IteratorResult<PaperTaskEvent>> {
          if (terminalRead) {
            return { done: true, value: undefined }
          }
          if (producer === undefined && handle.finalizer !== undefined) {
            return { done: true, value: undefined }
          }
          start()
          const item = await queue.take()
          terminalRead = item.event.type === 'terminal'
          return { done: false, value: item.event }
        },
        async return(): Promise<IteratorResult<PaperTaskEvent>> {
          suppressTerminal = true
          requestStop(handle, 'disconnect')
          if (producer === undefined) {
            handle.started = true
            producer = produceTask(handle, input, runtimeFactory, prepareSource, sourceStore, queue, branchQueue, runners, () => true)
          }
          await handle.settled
          return { done: true, value: undefined }
        },
      }
    },
  }
}

async function produceTask(
  handle: PaperTaskHandle,
  input: PaperTaskMultipartInput,
  runtimeFactory: PaperTaskRuntimeFactory,
  prepareSource: PreparePaperTaskSource,
  sourceStore: ReturnType<typeof createPaperTaskSourceStore>,
  queue: EventQueue<{ readonly kind: 'event'; readonly event: PaperTaskEvent }>,
  branchQueue: EventQueue,
  runners: Promise<void>[],
  suppressTerminal: () => boolean,
): Promise<void> {
  const selected = getSelectedBranches(input.selection)
  let outcome: PaperTaskOutcome = 'succeeded'
  queue.push({ kind: 'event', event: { type: 'accepted', taskId: handle.taskId, selection: input.selection } })
  queue.push({ kind: 'event', event: progressEvent(handle.taskId, 'preparing', null, 0, 1) })
  try {
    const prepared = await prepareSource(input.pdf, handle.controller.signal)
    if (handle.controller.signal.aborted) {
      return
    }
    if (!prepared.success) {
      outcome = 'failed'
      markUnfinished(handle.branches, selected, 'failed')
      return
    }
    queue.push({ kind: 'event', event: progressEvent(handle.taskId, 'preparing', null, 1, 1) })
    try {
      saveWorkContext(handle.workspaceRoot, {
        taskId: handle.taskId,
        selection: input.selection,
        pageCount: prepared.source.pageCount,
        sourceRecordsDir: workspacePaths(handle.workspaceRoot).sourceRecordsDir,
        assetsDir: workspacePaths(handle.workspaceRoot).assetsDir,
        sourceStatePath: workspacePaths(handle.workspaceRoot).sourceStatePath,
      })
      sourceStore.save(handle.taskId, handle.workspaceRoot, prepared.source, prepared.assets)
    } catch {
      outcome = 'failed'
      markUnfinished(handle.branches, selected, 'failed')
      return
    }

    const workContextPath = workspacePaths(handle.workspaceRoot).workContextPath
    const sourceRecords = sourceStore.records(handle.taskId, handle.workspaceRoot)
    if (sourceRecords === undefined) throw new Error('prepared source unavailable')
    const sourceReadPaths = sourceStore.workerReadPaths(handle.taskId, handle.workspaceRoot)
    const doneBranches = new Set<PaperTaskBranch>()
    for (const branch of selected) {
      if (handle.controller.signal.aborted) {
        break
      }
      try {
        const runtime = runtimeFactory({
          branch,
          workContextPath,
          sourceReadPaths,
          branchWorkspaceDir: workspacePaths(handle.workspaceRoot).branchDirectories[branch],
          runtimeHome: join(handle.runtimeRoot, branch),
          signal: handle.controller.signal,
        })
        handle.runtimes.set(branch, runtime)
        runners.push(runPaperTaskBranch({ handle, branch, runtime, queue: branchQueue, sourceRecords }))
      } catch {
        doneBranches.add(branch)
        handle.branches[branch] = 'failed'
        handle.anyFailed = true
      }
    }

    while (doneBranches.size < selected.length && !handle.controller.signal.aborted) {
      const item = await takeOrAbort(branchQueue, handle.controller.signal)
      if (item === undefined) {
        break
      }
      if (item.kind === 'event') {
        queue.push(item)
        continue
      }
      doneBranches.add(item.branch)
      handle.branches[item.branch] = item.ok ? 'sample-ready' : 'failed'
      handle.anyFailed ||= !item.ok
    }
  } catch {
    outcome = 'failed'
    markUnfinished(handle.branches, selected, 'failed')
  } finally {
    queue.push({ kind: 'event', event: progressEvent(handle.taskId, 'cleaning', null, 0, 1) })
    await finalizeHandle(handle, runners)
    queue.push({ kind: 'event', event: progressEvent(handle.taskId, 'cleaning', null, 1, 1) })
    if (handle.controller.signal.aborted) {
      markUnfinished(handle.branches, selected, 'cancelled')
      outcome = stopOutcome(handle)
    } else {
      markUnfinished(handle.branches, selected, handle.anyFailed || handle.cleanupFailed ? 'failed' : 'sample-ready')
      if (handle.anyFailed || handle.cleanupFailed) {
        outcome = 'failed'
      }
    }
    if (!suppressTerminal()) {
      queue.push({
        kind: 'event',
        event: terminalEvent(handle.taskId, outcome, handle.branches, cleanupStatus(handle)),
      })
    }
  }
}

function markUnfinished(
  branches: PaperTaskBranches,
  selected: readonly PaperTaskBranch[],
  state: 'cancelled' | 'failed' | 'sample-ready',
): void {
  for (const branch of selected) {
    if (branches[branch] !== 'sample-ready' && branches[branch] !== 'failed') {
      branches[branch] = state
    }
  }
}

function progressEvent(
  taskId: string,
  stage: 'preparing' | 'generating' | 'cleaning',
  branch: PaperTaskBranch | null,
  completed: number,
  total: number,
): PaperTaskEvent {
  return { type: 'progress', taskId, stage, branch, completed, total }
}

function terminalEvent(
  taskId: string,
  outcome: PaperTaskOutcome,
  branches: PaperTaskBranches,
  cleanup: 'clean' | 'failed',
): PaperTaskEvent {
  return { type: 'terminal', taskId, outcome, branches: { ...branches }, cleanup }
}
