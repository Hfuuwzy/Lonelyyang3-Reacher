import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import type { StoredPaperTaskSnapshot } from './task-index'
import { outcomeForHistoryStatus } from './task-index'
import {
  getSelectedBranches,
  type PaperTaskBranch,
  type PaperTaskBranches,
  type PaperTaskEvent,
  type PaperTaskOutcome,
} from '../../app/utils/paper-task-contract'
import type { PaperTaskPdfInput } from './multipart'
import type { PreparedPaperTaskSource } from './source-acquisition'
import { saveWorkContext, workspacePaths } from './workspace'
import type { PaperTaskRuntimeFactory } from './runtime'
import { cleanupStatus, finalizeHandle, type PaperTaskHandle } from './handle'
import { EventQueue, takeOrAbort } from './queue'
import type { createPaperTaskSourceStore } from './source-store'
import { runPaperTaskBranch } from './branch-stream'

export type PreparePaperTaskSource = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperTaskSourceResult>

/**
 * In-memory event history with independent replaying readers. Returning an
 * iterator only detaches that observer; it never signals the task producer.
 */
class ReplayablePaperTaskEvents implements AsyncIterable<PaperTaskEvent> {
  private readonly items: PaperTaskEvent[] = []
  private readonly waiters = new Set<() => void>()
  private closed = false

  push(event: PaperTaskEvent): void {
    this.items.push(event)
    for (const wake of [...this.waiters]) wake()
  }

  close(): void {
    this.closed = true
    for (const wake of [...this.waiters]) wake()
  }

  [Symbol.asyncIterator](): AsyncIterator<PaperTaskEvent> {
    let index = 0
    let finished = false
    let waiting: (() => void) | undefined
    let resolvePending: ((result: IteratorResult<PaperTaskEvent>) => void) | undefined
    const done: IteratorResult<PaperTaskEvent> = { done: true, value: undefined }

    const ready = (): IteratorResult<PaperTaskEvent> | undefined => {
      if (finished) return done
      const event = this.items[index]
      if (event !== undefined) {
        index += 1
        return { done: false, value: event }
      }
      if (this.closed) {
        finished = true
        return done
      }
      return undefined
    }

    return {
      next: () => {
        const immediate = ready()
        if (immediate !== undefined) return Promise.resolve(immediate)
        return new Promise<IteratorResult<PaperTaskEvent>>((resolveNext) => {
          const wake = (): void => {
            this.waiters.delete(wake)
            if (waiting === wake) waiting = undefined
            if (resolvePending === resolveNext) resolvePending = undefined
            resolveNext(ready() ?? done)
          }
          waiting = wake
          resolvePending = resolveNext
          this.waiters.add(wake)
        })
      },
      return: async () => {
        finished = true
        if (waiting !== undefined) this.waiters.delete(waiting)
        waiting = undefined
        const resolveNext = resolvePending
        resolvePending = undefined
        resolveNext?.(done)
        return done
      },
    }
  }
}

export function createTaskEvents(
  handle: PaperTaskHandle,
  input: PaperTaskPdfInput,
  runtimeFactory: PaperTaskRuntimeFactory,
  prepareSource: PreparePaperTaskSource,
  sourceStore: ReturnType<typeof createPaperTaskSourceStore>,
  unavailableBranches: readonly PaperTaskBranch[] = [],
  preparedSource?: PreparedPaperTaskSource,
  onEvent: (event: PaperTaskEvent) => void = () => undefined,
): AsyncIterable<PaperTaskEvent> {
  const events = new ReplayablePaperTaskEvents()
  const branchQueue = new EventQueue()
  const runners: Array<Promise<void>> = []
  handle.execution = produceTask(
    handle,
    input,
    runtimeFactory,
    prepareSource,
    sourceStore,
    events,
    branchQueue,
    runners,
    unavailableBranches,
    preparedSource,
    onEvent,
  ).catch(async () => {
    await finalizeHandle(handle)
    handle.anyFailed = true
    markUnfinished(handle.branches, getSelectedBranches(input.selection), 'failed')
    handle.outcome = 'failed'
    handle.onChange()
    events.push({
      type: 'terminal',
      taskId: handle.taskId,
      outcome: 'failed',
      branches: { ...handle.branches },
      cleanup: cleanupStatus(handle),
    })
  }).finally(() => events.close())
  return events
}

/** Replay only the persisted public snapshot for a recovered, already-settled task. */
export function createRecoveredTaskEvents(snapshot: StoredPaperTaskSnapshot): AsyncIterable<PaperTaskEvent> {
  const events = new ReplayablePaperTaskEvents()
  events.push({ type: 'accepted', taskId: snapshot.taskId, selection: snapshot.selection })
  const previewsByBranch = new Map(snapshot.previews.map((preview) => [preview.branch, preview]))
  for (const branch of getSelectedBranches(snapshot.selection)) {
    const preview = previewsByBranch.get(branch)
    if (preview !== undefined) {
      events.push({
        type: 'preview',
        taskId: snapshot.taskId,
        branch,
        designation: preview.designation,
        paragraphs: [...preview.paragraphs],
        ...(preview.quality === undefined ? {} : { quality: { ...preview.quality, issues: [...preview.quality.issues], options: [...preview.quality.options] } }),
      })
    }
  }
  events.push({
    type: 'terminal',
    taskId: snapshot.taskId,
    outcome: outcomeForHistoryStatus(snapshot.status),
    branches: { ...snapshot.branches },
    cleanup: snapshot.cleanup,
  })
  events.close()
  return events
}

async function produceTask(
  handle: PaperTaskHandle,
  input: PaperTaskPdfInput,
  runtimeFactory: PaperTaskRuntimeFactory,
  prepareSource: PreparePaperTaskSource,
  sourceStore: ReturnType<typeof createPaperTaskSourceStore>,
  events: ReplayablePaperTaskEvents,
  branchQueue: EventQueue,
  runners: Promise<void>[],
  unavailableBranches: readonly PaperTaskBranch[],
  preparedSource?: PreparedPaperTaskSource,
  onEvent: (event: PaperTaskEvent) => void = () => undefined,
): Promise<void> {
  const selected = getSelectedBranches(input.selection)
  let outcome: PaperTaskOutcome = 'succeeded'
  events.push({ type: 'accepted', taskId: handle.taskId, selection: input.selection })
  events.push(progressEvent(handle.taskId, 'preparing', null, 0, 1))
  try {
    const prepared = preparedSource ?? await prepareSource(input.pdf, handle.controller.signal)
    if (handle.controller.signal.aborted) {
      return
    }
    if (!prepared.success) {
      outcome = 'failed'
      markUnfinished(handle.branches, selected, 'failed')
      return
    }
    events.push(progressEvent(handle.taskId, 'preparing', null, 1, 1))
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
    const doneBranches = new Set<PaperTaskBranch>(unavailableBranches)
    for (const branch of unavailableBranches) {
      recordUnavailableBranchResources(handle.workspaceRoot, branch)
      handle.branches[branch] = 'failed'
      handle.anyFailed = true
    }
    if (unavailableBranches.length > 0) handle.onChange()
    for (const branch of selected) {
      if (unavailableBranches.includes(branch)) continue
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
        handle.branches[branch] = 'running'
        handle.onChange()
        handle.runtimes.set(branch, runtime)
        runners.push(runPaperTaskBranch({ handle, branch, runtime, queue: branchQueue, sourceRecords }))
      } catch {
        doneBranches.add(branch)
        handle.branches[branch] = 'failed'
        handle.anyFailed = true
        handle.onChange()
      }
    }

    while (doneBranches.size < selected.length && !handle.controller.signal.aborted) {
      const item = await takeOrAbort(branchQueue, handle.controller.signal)
      if (item === undefined) {
        break
      }
      if (item.kind === 'event') {
        events.push(item.event)
        onEvent(item.event)
        continue
      }
      doneBranches.add(item.branch)
      handle.branches[item.branch] = item.ok ? item.state : 'failed'
      handle.anyFailed ||= !item.ok
      handle.onChange()
    }
  } catch {
    outcome = 'failed'
    markUnfinished(handle.branches, selected, 'failed')
    handle.onChange()
  } finally {
    events.push(progressEvent(handle.taskId, 'cleaning', null, 0, 1))
    await finalizeHandle(handle, runners)
    events.push(progressEvent(handle.taskId, 'cleaning', null, 1, 1))
    if (handle.controller.signal.aborted) {
      markUnfinished(handle.branches, selected, 'cancelled')
      outcome = 'cancelled'
    } else {
      markUnfinished(handle.branches, selected, handle.anyFailed || handle.cleanupFailed ? 'failed' : 'sample-ready')
      if (handle.anyFailed || handle.cleanupFailed) {
        outcome = 'failed'
      }
    }
    handle.outcome = outcome
    handle.onChange()
    events.push(terminalEvent(handle.taskId, outcome, handle.branches, cleanupStatus(handle)))
  }
}

const UNAVAILABLE_BRANCH_RESOURCE_MESSAGE = 'The selected branch did not start because its local skill resources are unavailable or invalid. Check the local skill configuration and retry.'

function recordUnavailableBranchResources(workspaceRoot: string, branch: PaperTaskBranch): void {
  const record = {
    at: new Date().toISOString(),
    branch,
    stage: 'preflight',
    code: 'GENERATION_RESOURCES_UNAVAILABLE',
    name: 'GenerationResourcesUnavailableError',
    timedOut: false,
    message: UNAVAILABLE_BRANCH_RESOURCE_MESSAGE,
  }
  try {
    writeFileSync(join(workspacePaths(workspaceRoot).branchDirectories[branch], 'runtime-error.json'), JSON.stringify(record), { flag: 'w', mode: 0o600 })
  } catch {
    // Diagnostics are best effort; task status must still settle if the retained workspace is unavailable.
  }
  console.error(`[paper-task] ${branch} runtime preflight failed: ${record.code}`)
}

function markUnfinished(
  branches: PaperTaskBranches,
  selected: readonly PaperTaskBranch[],
  state: 'cancelled' | 'failed' | 'sample-ready',
): void {
  for (const branch of selected) {
    if (branches[branch] !== 'sample-ready' && branches[branch] !== 'preview-ready'
      && branches[branch] !== 'needs-confirmation' && branches[branch] !== 'complete' && branches[branch] !== 'failed') {
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
