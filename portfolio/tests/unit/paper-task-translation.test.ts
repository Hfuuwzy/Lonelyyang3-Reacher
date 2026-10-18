import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  usePaperTaskTranslation,
  type PaperTaskTranslation,
  type PaperTaskTranslationTransport,
} from '../../app/composables/paper-task-translation'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const OTHER_TASK_ID = '123e4567-e89b-12d3-a456-426614174001'

function view(taskId: string, markdown = '# 主稿\n\n正文。'): Record<string, unknown> {
  return { taskId, status: 'complete', markdown, assets: [], unresolved: [], staleParagraphs: [] }
}

function harness(transport: PaperTaskTranslationTransport, taskId: string | null = TASK_ID): {
  readonly taskId: Ref<string | null>
  readonly ready: Ref<boolean>
  readonly translation: PaperTaskTranslation
  readonly scope: EffectScope
} {
  const taskIdRef = ref(taskId)
  const ready = ref(false)
  const scope = effectScope()
  const translation = scope.run(() => usePaperTaskTranslation(taskIdRef, ready, { transport }))
  if (translation === undefined) throw new Error('translation controller was not created')
  return { taskId: taskIdRef, ready, translation, scope }
}

describe('paper task translation controller', () => {
  it('loads only after the translation preview is ready and ignores a stale task response', async () => {
    const requests: Array<{ taskId: string; resolve: (payload: unknown) => void }> = []
    const { ready, taskId, translation, scope } = harness((requested, _signal) => new Promise((resolve) => {
      requests.push({ taskId: requested, resolve })
    }))
    expect(translation.state.value.kind).toBe('idle')

    ready.value = true
    expect(translation.state.value.kind).toBe('loading')

    taskId.value = OTHER_TASK_ID
    expect(requests).toHaveLength(2)
    requests[0]?.resolve(view(TASK_ID))
    await Promise.resolve()
    expect(translation.state.value.kind).toBe('loading')

    requests[1]?.resolve(view(OTHER_TASK_ID, '# 另一篇\n\n正文。'))
    await Promise.resolve()
    expect(translation.state.value).toMatchObject({ kind: 'loaded', view: { taskId: OTHER_TASK_ID } })
    scope.stop()
  })

  it('rejects a payload for another task', async () => {
    const { ready, translation, scope } = harness(async () => view(OTHER_TASK_ID))
    ready.value = true
    await Promise.resolve()
    await Promise.resolve()
    expect(translation.state.value.kind).toBe('error')
    scope.stop()
  })

  it('refreshes a loaded master so a correction status becomes visible', async () => {
    const payloads = [view(TASK_ID), { ...view(TASK_ID), status: 'needs-update', staleParagraphs: [0] }]
    let request = 0
    const { ready, translation, scope } = harness(async () => payloads[request++] ?? view(TASK_ID))
    ready.value = true
    await Promise.resolve()
    await Promise.resolve()
    expect(translation.state.value).toMatchObject({ kind: 'loaded', view: { status: 'complete' } })

    translation.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(translation.state.value).toMatchObject({ kind: 'loaded', view: { status: 'needs-update', staleParagraphs: [0] } })
    expect(request).toBe(2)
    scope.stop()
  })
})
