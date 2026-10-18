import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  usePaperTaskReader,
  type PaperTaskReader,
  type PaperTaskReaderTransport,
} from '../../app/composables/paper-task-reader'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_TASK_ID = '123e4567-e89b-12d3-a456-426614174001'

function view(taskId: string, status: 'preview' | 'needs-confirmation' = 'preview'): Record<string, unknown> {
  return {
    taskId,
    branches: { translation: 'preview-ready', 'deep-reading': 'not-selected' },
    documents: [{
      branch: 'translation',
      status,
      notice: status === 'needs-confirmation' ? '仍有可能需要人工确认的疑点；已有可读内容保留。' : null,
      markdown: '# 主稿\n\n正文。',
      assets: [],
    }],
    pdfs: {
      original: { available: true, message: '原论文 PDF 可查看。' },
      translated: { available: false, message: '译文 PDF 尚未生成或尚未通过全页检查。' },
    },
  }
}

function harness(transport: PaperTaskReaderTransport, taskId: string | null = TASK_ID): {
  readonly taskId: Ref<string | null>
  readonly ready: Ref<boolean>
  readonly reader: PaperTaskReader
  readonly scope: EffectScope
} {
  const taskIdRef = ref(taskId)
  const ready = ref(false)
  const scope = effectScope()
  const reader = scope.run(() => usePaperTaskReader(taskIdRef, ready, { transport }))
  if (reader === undefined) throw new Error('reader controller was not created')
  return { taskId: taskIdRef, ready, reader, scope }
}

describe('paper task reader controller', () => {
  it('loads only after a task result is ready and ignores a stale task response', async () => {
    const requests: Array<{ taskId: string; resolve: (payload: unknown) => void }> = []
    const { ready, taskId, reader, scope } = harness((requested, _signal) => new Promise((resolve) => {
      requests.push({ taskId: requested, resolve })
    }))
    expect(reader.state.value.kind).toBe('idle')

    ready.value = true
    expect(reader.state.value.kind).toBe('loading')

    taskId.value = OTHER_TASK_ID
    expect(requests).toHaveLength(2)
    requests[0]?.resolve(view(TASK_ID))
    await Promise.resolve()
    expect(reader.state.value.kind).toBe('loading')

    requests[1]?.resolve(view(OTHER_TASK_ID))
    await Promise.resolve()
    expect(reader.state.value).toMatchObject({ kind: 'loaded', view: { taskId: OTHER_TASK_ID } })
    scope.stop()
  })

  it('rejects a reader payload for another task', async () => {
    const { ready, reader, scope } = harness(async () => view(OTHER_TASK_ID))
    ready.value = true
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.state.value.kind).toBe('error')
    scope.stop()
  })

  it('refreshes a loaded reader so a new branch status becomes visible', async () => {
    const payloads = [view(TASK_ID), view(TASK_ID, 'needs-confirmation')]
    let request = 0
    const { ready, reader, scope } = harness(async () => payloads[request++] ?? view(TASK_ID))
    ready.value = true
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.state.value).toMatchObject({ kind: 'loaded', view: { documents: [{ status: 'preview' }] } })

    reader.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.state.value).toMatchObject({ kind: 'loaded', view: { documents: [{ status: 'needs-confirmation' }] } })
    expect(request).toBe(2)
    scope.stop()
  })

  it('aborts on unmount and suppresses a late reader response', async () => {
    const requests: Array<{ signal: AbortSignal; resolve: (payload: unknown) => void }> = []
    const { ready, reader, scope } = harness((_taskId, signal) => new Promise((resolve) => {
      requests.push({ signal, resolve })
    }), TASK_ID)
    ready.value = true
    const request = requests[0]
    if (request === undefined) throw new Error('Expected one reader request.')

    scope.stop()
    request.resolve(view(TASK_ID))
    await Promise.resolve()
    expect(request.signal.aborted).toBe(true)
    expect(reader.state.value.kind).toBe('idle')
  })
})
