import { join } from 'node:path'
import type { PaperExtractionResult } from '../utils/paper-review/pdf'
import {
  getSelectedBranches,
  type PaperTaskBranch,
  type PaperTaskBranches,
  type PaperTaskEvent,
  type PaperTaskOutcome,
} from '../../app/utils/paper-task-contract'
import type { PaperTaskMultipartInput } from './multipart'
import { saveDraft, saveWorkContext, workspacePaths } from './workspace'
import type { PaperTaskRuntime, PaperTaskRuntimeFactory } from './runtime'
import { cleanupStatus, closeRuntime, finalizeHandle, requestStop, stopOutcome, type PaperTaskHandle } from './handle'
import { EventQueue, takeOrAbort } from './queue'

export type ExtractPaperPages = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperExtractionResult>

const EXCERPT_CHAR_CAP = 6000

export function createTaskEvents(
  handle: PaperTaskHandle,
  input: PaperTaskMultipartInput,
  runtimeFactory: PaperTaskRuntimeFactory,
  extractPaperPages: ExtractPaperPages,
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
    producer = produceTask(handle, input, runtimeFactory, extractPaperPages, queue, branchQueue, runners, () => suppressTerminal)
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
            producer = produceTask(handle, input, runtimeFactory, extractPaperPages, queue, branchQueue, runners, () => true)
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
  extractPaperPages: ExtractPaperPages,
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
    const extraction = await extractPaperPages(input.pdf, handle.controller.signal)
    if (handle.controller.signal.aborted) {
      return
    }
    if (!extraction.success) {
      outcome = 'failed'
      markUnfinished(handle.branches, selected, 'failed')
      return
    }
    queue.push({ kind: 'event', event: progressEvent(handle.taskId, 'preparing', null, 1, 1) })
    try {
      saveWorkContext(handle.workspaceRoot, {
        taskId: handle.taskId,
        selection: input.selection,
        pageCount: extraction.pageCount,
        sourceExcerpt: buildExcerpt(extraction.pages),
      })
    } catch {
      outcome = 'failed'
      markUnfinished(handle.branches, selected, 'failed')
      return
    }

    const workContextPath = workspacePaths(handle.workspaceRoot).workContextPath
    const doneBranches = new Set<PaperTaskBranch>()
    for (const branch of selected) {
      if (handle.controller.signal.aborted) {
        break
      }
      try {
        const runtime = runtimeFactory({
          branch,
          workContextPath,
          runtimeHome: join(handle.runtimeRoot, branch),
          signal: handle.controller.signal,
        })
        handle.runtimes.set(branch, runtime)
        runners.push(runBranch(handle, branch, runtime, branchQueue))
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

async function runBranch(
  handle: PaperTaskHandle,
  branch: PaperTaskBranch,
  runtime: PaperTaskRuntime,
  queue: EventQueue,
): Promise<void> {
  let ok = false
  let sawPreview = false
  try {
    const events = runtime.events()[Symbol.asyncIterator]()
    while (!handle.controller.signal.aborted) {
      const next = await awaitOrAbort(events.next(), handle.controller.signal)
      if (next.kind === 'aborted' || next.value.done || handle.controller.signal.aborted) {
        break
      }
      const event = next.value.value
      if (event.type === 'progress') {
        queue.push({ kind: 'event', event: progressEvent(handle.taskId, event.stage, branch, event.completed, event.total) })
      } else {
        try {
          saveDraft(handle.workspaceRoot, branch, { designation: 'sample', paragraphs: [...event.paragraphs] })
        } catch {
          throw new Error('draft write failed')
        }
        sawPreview = true
        queue.push({ kind: 'event', event: { type: 'preview', taskId: handle.taskId, branch, designation: 'sample', paragraphs: [...event.paragraphs] } })
      }
    }
    if (!handle.controller.signal.aborted) {
      const result = await awaitOrAbort(runtime.result, handle.controller.signal)
      ok = result.kind === 'value' && result.value.ok && sawPreview
    }
  } catch {
    ok = false
  } finally {
    if (ok) {
      handle.branches[branch] = 'sample-ready'
    } else if (!handle.controller.signal.aborted) {
      handle.branches[branch] = 'failed'
    }
    void closeRuntime(handle, runtime)
    queue.push({ kind: 'done', branch, ok })
  }
}

function awaitOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<{ readonly kind: 'value'; readonly value: T } | { readonly kind: 'aborted' }> {
  if (signal.aborted) {
    return Promise.resolve({ kind: 'aborted' })
  }
  let removeAbortListener = (): void => undefined
  const aborted = new Promise<{ readonly kind: 'aborted' }>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', onAbort)
  })
  return Promise.race([
    promise.then((value) => ({ kind: 'value' as const, value })),
    aborted,
  ]).finally(removeAbortListener)
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

function buildExcerpt(pages: readonly { readonly text: string }[]): string {
  return pages.map((page) => page.text).join('\n').slice(0, EXCERPT_CHAR_CAP)
}
