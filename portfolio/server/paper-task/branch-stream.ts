import type { PaperTaskBranch } from '../../app/utils/paper-task-contract'
import type { PaperTaskHandle } from './handle'
import { closeRuntime } from './handle'
import type { PaperTaskRuntime } from './runtime'
import type { EventQueue } from './queue'
import { saveDraft, saveDraftPiece, saveGeneratedPreview } from './workspace'
import { validateWorkerPreview } from './source-pieces'

export type PaperTaskBranchRun = {
  readonly handle: PaperTaskHandle
  readonly branch: PaperTaskBranch
  readonly runtime: PaperTaskRuntime
  readonly queue: EventQueue
  readonly sourceRecords: Parameters<typeof validateWorkerPreview>[2]
}

export async function runPaperTaskBranch(run: PaperTaskBranchRun): Promise<void> {
  const { handle, branch, runtime, queue, sourceRecords } = run
  let ok = false
  let sawPreview = false
  let state: 'sample-ready' | 'preview-ready' | 'needs-confirmation' | 'complete' = 'sample-ready'
  try {
    const events = runtime.events()[Symbol.asyncIterator]()
    while (!handle.controller.signal.aborted) {
      const next = await awaitOrAbort(events.next(), handle.controller.signal)
      if (next.kind === 'aborted' || next.value.done || handle.controller.signal.aborted) break
      const event = next.value.value
      if (event.type === 'progress') {
        queue.push({ kind: 'event', event: { type: 'progress', taskId: handle.taskId, branch,
          stage: event.stage, completed: event.completed, total: event.total } })
      } else if (event.type === 'generated-preview') {
        saveGeneratedPreview(handle.workspaceRoot, branch, event.markdown)
        sawPreview = true
        state = event.quality.status === 'complete'
          ? 'complete'
          : event.quality.status === 'needs-confirmation' ? 'needs-confirmation' : 'preview-ready'
        handle.branches[branch] = state
        handle.onChange()
        queue.push({
          kind: 'event',
          event: {
            type: 'preview', taskId: handle.taskId, branch, designation: 'generated-preview',
            paragraphs: [...event.paragraphs], quality: { ...event.quality, issues: [...event.quality.issues], options: [...event.quality.options] },
          },
        })
      } else {
        const validated = validateWorkerPreview(event, branch, sourceRecords)
        if (validated === undefined) throw new Error('preview dependencies invalid')
        saveDraft(handle.workspaceRoot, branch, { designation: 'sample', paragraphs: [...event.paragraphs] })
        for (const piece of validated.pieces) {
          saveDraftPiece(handle.workspaceRoot, branch, { id: piece.id, dependencies: piece.dependencies, stale: false })
        }
        sawPreview = true
        handle.branches[branch] = 'sample-ready'
        handle.onChange()
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
    if (ok) handle.branches[branch] = state
    else if (!handle.controller.signal.aborted) handle.branches[branch] = 'failed'
    handle.onChange()
    void closeRuntime(handle, runtime)
    queue.push({ kind: 'done', branch, ok, state })
  }
}

function awaitOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<{ readonly kind: 'value'; readonly value: T } | { readonly kind: 'aborted' }> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  let removeAbortListener = (): void => undefined
  const aborted = new Promise<{ readonly kind: 'aborted' }>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', onAbort)
  })
  return Promise.race([promise.then((value) => ({ kind: 'value' as const, value })), aborted]).finally(removeAbortListener)
}
