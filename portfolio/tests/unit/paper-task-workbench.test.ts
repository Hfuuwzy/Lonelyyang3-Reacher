import { describe, expect, it } from 'vitest'
import {
  usePaperTaskWorkbench,
  type PaperTaskWorkbenchLifecycleCallbacks,
} from '../../app/composables/paper-task-workbench'
import type {
  PaperTaskSubmitRequest,
  PaperTaskSubmitResult,
  PaperTaskWorkbenchTransport,
} from '../../app/composables/paper-task-workbench-transport'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import { consumePaperTaskStream } from '../../app/utils/paper-task-stream'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const EOF_OUTCOME: PaperTaskSubmitResult = {
  kind: 'stream',
  outcome: {
    kind: 'error',
    error: {
      type: 'stream-error',
      code: 'missing-terminal-event',
      message: '任务流已结束但未收到终止事件。',
    },
  },
}

const ACCEPTED: PaperTaskEvent = { type: 'accepted', taskId: TASK_ID, selection: 'both' }

const TRANSLATION_PREVIEW: PaperTaskEvent = {
  type: 'preview',
  taskId: TASK_ID,
  branch: 'translation',
  designation: 'sample',
  paragraphs: ['服务端提供的样例译文。'],
}

const GENERATED_TRANSLATION_PREVIEW: PaperTaskEvent = {
  type: 'preview',
  taskId: TASK_ID,
  branch: 'translation',
  designation: 'generated-preview',
  paragraphs: ['服务端提供的未完成文本预览。'],
}

const SUCCESSFUL_TERMINAL: PaperTaskEvent = {
  type: 'terminal',
  taskId: TASK_ID,
  outcome: 'succeeded',
  branches: { translation: 'sample-ready', 'deep-reading': 'sample-ready' },
  cleanup: 'clean',
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) {
        throw new Error('Submission promise has not been initialized.')
      }
      resolvePromise(value)
    },
  }
}

function createHarness() {
  const submission = deferred<PaperTaskSubmitResult>()
  const submitRequests: PaperTaskSubmitRequest[] = []
  const cancelRequests: string[] = []
  const deleteRequests: string[] = []
  let submitRequest: PaperTaskSubmitRequest | undefined
  let cancelResponse: unknown = { ok: false, code: 'cleanup-failed' }
  let deleteResponse: unknown = { ok: false, code: 'cleanup-failed' }
  let lifecycle: PaperTaskWorkbenchLifecycleCallbacks | undefined

  const transport: PaperTaskWorkbenchTransport = {
    submit(request) {
      submitRequests.push(request)
      submitRequest = request
      return submission.promise
    },
    async cancel(taskId) {
      cancelRequests.push(taskId)
      return cancelResponse
    },
    async delete(taskId) {
      deleteRequests.push(taskId)
      return deleteResponse
    },
  }

  const workbench = usePaperTaskWorkbench({
    transport,
    registerLifecycle(callbacks) {
      lifecycle = callbacks
    },
  })
  workbench.pdfFile.value = new File(['paper'], 'paper.pdf', { type: 'application/pdf' })

  return {
    workbench,
    submitRequests,
    cancelRequests,
    deleteRequests,
    emit(event: PaperTaskEvent) {
      if (submitRequest === undefined) {
        throw new Error('Task submission has not started.')
      }
      submitRequest.onEvent(event)
    },
    resolveSubmission(result: PaperTaskSubmitResult) {
      submission.resolve(result)
    },
    setCancelResponse(response: unknown) {
      cancelResponse = response
    },
    setDeleteResponse(response: unknown) {
      deleteResponse = response
    },
    dispose() {
      if (lifecycle === undefined) {
        throw new Error('Lifecycle callbacks have not been registered.')
      }
      lifecycle.dispose()
    },
    get signal(): AbortSignal | undefined {
      return submitRequest?.signal
    },
  }
}

async function* encodedEvents(events: readonly PaperTaskEvent[]): AsyncGenerator<string> {
  yield events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
}

async function completeWithPreview(harness: ReturnType<typeof createHarness>): Promise<void> {
  const submission = harness.workbench.handleSubmit()
  harness.emit(ACCEPTED)
  harness.emit(TRANSLATION_PREVIEW)
  harness.resolveSubmission(EOF_OUTCOME)
  await submission
}

describe('paper-task workbench', () => {
  it('shows no task preview before the task emits one', () => {
    const harness = createHarness()

    expect(harness.workbench.previewCards.value).toEqual([])
  })

  it('consumes the selected PDF at submission and does not reuse it after a result', async () => {
    const harness = createHarness()
    const selectedFile = harness.workbench.pdfFile.value
    harness.workbench.selection.value = 'translation'

    const submission = harness.workbench.handleSubmit()

    expect(harness.workbench.pdfFile.value).toBeNull()
    expect(harness.submitRequests).toHaveLength(1)
    expect(harness.submitRequests[0]?.file).toBe(selectedFile)
    expect(harness.submitRequests[0]?.selection).toBe('translation')

    harness.workbench.selection.value = 'deep-reading'
    harness.emit(ACCEPTED)
    harness.emit(TRANSLATION_PREVIEW)
    harness.emit(SUCCESSFUL_TERMINAL)
    harness.resolveSubmission({ kind: 'stream', outcome: { kind: 'terminal', terminal: SUCCESSFUL_TERMINAL } })
    await submission

    expect(harness.workbench.phase.value).toBe('result')
    expect(harness.workbench.pdfFile.value).toBeNull()

    await harness.workbench.handleSubmit()

    expect(harness.submitRequests).toHaveLength(1)
  })

  it('accumulates progress per branch and lets trusted terminal states replace it', async () => {
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    harness.emit(ACCEPTED)
    harness.emit({
      type: 'progress', taskId: TASK_ID, stage: 'generating', branch: 'translation', completed: 0, total: 2,
    })
    expect(harness.workbench.branchStates.value).toEqual({ translation: 'running', 'deep-reading': 'pending' })

    harness.emit({
      type: 'progress', taskId: TASK_ID, stage: 'generating', branch: 'deep-reading', completed: 1, total: 2,
    })
    harness.emit(TRANSLATION_PREVIEW)
    harness.emit({
      type: 'progress', taskId: TASK_ID, stage: 'generating', branch: 'translation', completed: 1, total: 2,
    })
    harness.emit({
      type: 'progress', taskId: TASK_ID, stage: 'generating', branch: 'deep-reading', completed: 2, total: 2,
    })
    expect(harness.workbench.branchStates.value).toEqual({ translation: 'sample-ready', 'deep-reading': 'running' })

    const terminal: PaperTaskEvent = {
      type: 'terminal',
      taskId: TASK_ID,
      outcome: 'failed',
      branches: { translation: 'sample-ready', 'deep-reading': 'failed' },
      cleanup: 'clean',
    }
    harness.emit(terminal)
    harness.resolveSubmission({ kind: 'stream', outcome: { kind: 'terminal', terminal } })
    await submission

    expect(harness.workbench.branchStates.value).toEqual(terminal.branches)
    expect(harness.workbench.previewCards.value.map((card) => card.branch)).toEqual(['translation'])
  })

  it('labels successful sample output as a sample task', async () => {
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    harness.emit(ACCEPTED)
    harness.emit(TRANSLATION_PREVIEW)
    harness.emit({
      type: 'preview',
      taskId: TASK_ID,
      branch: 'deep-reading',
      designation: 'sample',
      paragraphs: ['服务端提供的深读样例。'],
    })
    harness.resolveSubmission({ kind: 'stream', outcome: { kind: 'terminal', terminal: SUCCESSFUL_TERMINAL } })
    await submission

    expect(harness.workbench.terminalTitle.value).toBe('样例任务结束')
    expect(harness.workbench.previewCards.value[0]?.badge).toBe('SAMPLE')
  })

  it('keeps generated text previews distinct from samples', async () => {
    // Given a task that emits one generated preview and one sample.
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    harness.emit(ACCEPTED)
    harness.emit(GENERATED_TRANSLATION_PREVIEW)
    harness.emit({
      type: 'preview',
      taskId: TASK_ID,
      branch: 'deep-reading',
      designation: 'sample',
      paragraphs: ['服务端提供的深读样例。'],
    })

    // When the mixed preview stream reaches its terminal event.
    const terminal: PaperTaskEvent = {
      type: 'terminal',
      taskId: TASK_ID,
      outcome: 'succeeded',
      branches: { translation: 'preview-ready', 'deep-reading': 'sample-ready' },
      cleanup: 'clean',
    }
    harness.emit(terminal)
    harness.resolveSubmission({ kind: 'stream', outcome: { kind: 'terminal', terminal } })
    await submission

    // Then the generated preview has its own designation, status, and unfinished badge.
    expect(harness.workbench.previewCards.value.map((card) => ({
      designation: card.designation,
      headingLabel: card.headingLabel,
      badge: card.badge,
    }))).toEqual([
      {
        designation: 'generated-preview',
        headingLabel: '文本预览',
        badge: '文本预览 · 未完成 · 未经质量检查',
      },
      { designation: 'sample', headingLabel: '样例', badge: 'SAMPLE' },
    ])
    expect(harness.workbench.stateLabel(harness.workbench.branchStates.value.translation)).toBe('文本预览就绪')
    expect(harness.workbench.terminalTitle.value).toBe('文本预览任务结束')
  })

  it('keeps a streamed preview visible during running and after network EOF', async () => {
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    const streamOutcome = await consumePaperTaskStream(
      encodedEvents([ACCEPTED, TRANSLATION_PREVIEW]),
      { selection: 'both', onEvent: harness.emit },
    )

    const preview = harness.workbench.previewCards.value.find((card) => card.branch === 'translation')
    expect(harness.workbench.phase.value).toBe('running')
    expect(harness.workbench.previewCards.value).toHaveLength(1)
    expect(preview?.paragraphs).toEqual(TRANSLATION_PREVIEW.paragraphs)

    harness.resolveSubmission({ kind: 'stream', outcome: streamOutcome })
    await submission

    expect(harness.workbench.phase.value).toBe('error')
    expect(harness.workbench.taskId.value).toBe(TASK_ID)
    expect(harness.workbench.previewCards.value.find((card) => card.branch === 'translation')?.paragraphs)
      .toEqual(TRANSLATION_PREVIEW.paragraphs)
  })

  it('keeps the cancel cleanup error and previews when the stream later finishes', async () => {
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    harness.emit(ACCEPTED)
    harness.emit(TRANSLATION_PREVIEW)
    harness.emit({
      type: 'preview',
      taskId: TASK_ID,
      branch: 'deep-reading',
      designation: 'sample',
      paragraphs: ['服务端提供的深读样例。'],
    })

    await harness.workbench.handleCancel()
    const cancelError = harness.workbench.errorMessage.value
    harness.emit(SUCCESSFUL_TERMINAL)
    harness.resolveSubmission({ kind: 'stream', outcome: { kind: 'terminal', terminal: SUCCESSFUL_TERMINAL } })
    await submission

    expect(harness.cancelRequests).toEqual([TASK_ID])
    expect(harness.workbench.phase.value).toBe('error')
    expect(cancelError).toContain('清理失败')
    expect(harness.workbench.errorMessage.value).toBe(cancelError)
    expect(harness.workbench.previewCards.value.map((card) => card.branch)).toEqual(['translation', 'deep-reading'])
  })

  it('retains task previews when delete cleanup fails', async () => {
    const harness = createHarness()
    await completeWithPreview(harness)
    harness.setDeleteResponse({ ok: false, code: 'cleanup-failed' })

    await harness.workbench.handleDelete()

    expect(harness.deleteRequests).toEqual([TASK_ID])
    expect(harness.workbench.phase.value).toBe('error')
    expect(harness.workbench.taskId.value).toBe(TASK_ID)
    expect(harness.workbench.errorMessage.value).toContain('清理失败')
    expect(harness.workbench.previewCards.value.find((card) => card.branch === 'translation')?.paragraphs)
      .toEqual(TRANSLATION_PREVIEW.paragraphs)
  })

  it('clears task state and previews only after successful deletion', async () => {
    const harness = createHarness()
    await completeWithPreview(harness)
    harness.workbench.pdfFile.value = new File(['next'], 'next.pdf', { type: 'application/pdf' })
    harness.setDeleteResponse({ ok: true, code: 'deleted' })

    await harness.workbench.handleDelete()

    expect(harness.deleteRequests).toEqual([TASK_ID])
    expect(harness.workbench.phase.value).toBe('idle')
    expect(harness.workbench.taskId.value).toBeNull()
    expect(harness.workbench.pdfFile.value).toBeNull()
    expect(harness.workbench.errorMessage.value).toBe('')
    expect(harness.workbench.previewCards.value).toEqual([])
  })

  it('aborts active submission through the injected cleanup hook', async () => {
    const harness = createHarness()
    const submission = harness.workbench.handleSubmit()
    harness.emit(ACCEPTED)

    harness.dispose()

    expect(harness.signal?.aborted).toBe(true)
    harness.resolveSubmission(EOF_OUTCOME)
    await submission
  })
})
