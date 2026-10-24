// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PaperTaskWorkbench from '../../app/components/agents/PaperTaskWorkbench.vue'
import PaperTaskApiSettings from '../../app/components/prototype/PaperTaskApiSettings.vue'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import type { PaperTaskSubmitResult, PaperTaskWorkbenchTransport } from '../../app/composables/paper-task-workbench-transport'

const recoveryMock = vi.hoisted(() => ({
  historyResponse: [] as unknown,
  observationEvents: [] as unknown[],
  observationResult: { kind: 'http-error', status: 404 } as unknown,
  readerState: { kind: 'idle' } as unknown,
  submitCalls: 0,
  deleteCalls: [] as string[],
  deleteResponse: { ok: true, code: 'deleted' } as unknown,
}))

vi.mock('../../app/composables/paper-task-workbench-transport', () => ({
  createPaperTaskWorkbenchTransport: () => ({
    submit: async () => {
      recoveryMock.submitCalls += 1
      return { kind: 'http-error', status: 503 }
    },
    history: async () => recoveryMock.historyResponse,
    observe: async (request: Parameters<PaperTaskWorkbenchTransport['observe']>[0]) => {
      for (const event of recoveryMock.observationEvents as PaperTaskEvent[]) request.onEvent(event)
      return recoveryMock.observationResult as PaperTaskSubmitResult
    },
    cancel: async () => ({ ok: true, code: 'stopped' }),
    delete: async (taskId: string) => {
      recoveryMock.deleteCalls.push(taskId)
      const result = recoveryMock.deleteResponse as { readonly ok?: boolean }
      if (result.ok === true && Array.isArray(recoveryMock.historyResponse)) {
        recoveryMock.historyResponse = (recoveryMock.historyResponse as Array<{ readonly taskId: string }>)
          .filter((entry) => entry.taskId !== taskId)
      }
      return recoveryMock.deleteResponse as Awaited<ReturnType<PaperTaskWorkbenchTransport['delete']>>
    },
  }),
}))

vi.mock('../../app/composables/paper-task-reader', async () => {
  const vue = await import('vue')
  return {
    usePaperTaskReader: () => ({
      state: vue.ref(recoveryMock.readerState),
      refresh: async () => undefined,
    }),
  }
})

vi.mock('../../app/composables/paper-task-api-settings', async () => {
  const vue = await import('vue')
  return {
    usePaperTaskApiSettings: () => ({
      form: vue.reactive({
        providerLabel: 'Local provider',
        baseUrl: 'https://api.example.test/v1',
        protocol: 'openai-completions',
        model: 'model-a',
        imageInput: false,
        apiKey: '',
      }),
      phase: vue.ref('ready'),
      notice: vue.ref(null),
      status: vue.ref({
        configured: true,
        providerLabel: 'Local provider',
        baseUrl: 'https://api.example.test/v1',
        protocol: 'openai-completions',
        model: 'model-a',
        imageInput: false,
        apiKeyConfigured: true,
      }),
      handleApply: async () => undefined,
      handleClear: async () => undefined,
      handleReload: async () => undefined,
    }),
  }
})

const NuxtLinkStub = defineComponent({
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

let restoreDialogMethods: (() => void) | null = null

function installNativeDialogMethods(): void {
  const prototype = HTMLDialogElement.prototype
  const showModalDescriptor = Object.getOwnPropertyDescriptor(prototype, 'showModal')
  const closeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'close')
  Object.defineProperty(prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
      this.querySelector<HTMLElement>('[autofocus]')?.focus()
    },
  })
  Object.defineProperty(prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    },
  })
  restoreDialogMethods = () => {
    if (showModalDescriptor === undefined) delete (prototype as Partial<HTMLDialogElement>).showModal
    else Object.defineProperty(prototype, 'showModal', showModalDescriptor)
    if (closeDescriptor === undefined) delete (prototype as Partial<HTMLDialogElement>).close
    else Object.defineProperty(prototype, 'close', closeDescriptor)
  }
}

function setupNuxtGlobals(): void {
  vi.stubGlobal('useLocalePath', () => (path: string) => path)
}

function mountWorkbench(attachTo?: Element) {
  return mount(PaperTaskWorkbench, {
    attachTo,
    global: {
      components: { NuxtLink: NuxtLinkStub },
      stubs: {
        PaperTaskSourceMaterials: true,
      },
    },
  })
}

afterEach(() => {
  restoreDialogMethods?.()
  restoreDialogMethods = null
  vi.unstubAllGlobals()
  recoveryMock.historyResponse = []
  recoveryMock.observationEvents = []
  recoveryMock.observationResult = { kind: 'http-error', status: 404 }
  recoveryMock.readerState = { kind: 'idle' }
  recoveryMock.submitCalls = 0
  recoveryMock.deleteCalls = []
  recoveryMock.deleteResponse = { ok: true, code: 'deleted' }
})

describe('formal paper-task surfaces', () => {
  it('presents a single-paper workbench with source and all three branch selections', () => {
    setupNuxtGlobals()
    const wrapper = mountWorkbench()

    expect(wrapper.get('h1').text()).toBe('论文任务工作台')
    expect(wrapper.get('.paper-task__settings-action').attributes('href')).toBe('/agents/paper/settings')
    expect(wrapper.get('#paper-task-source-url').attributes('type')).toBe('url')
    expect(wrapper.get('#paper-task-pdf').attributes('accept')).toBe('application/pdf')
    expect(wrapper.find('[data-testid="paper-task-history"]').exists()).toBe(true)
    expect(wrapper.findAll('input[name="selection"]').map((input) => input.element.value)).toEqual([
      'translation',
      'deep-reading',
      'both',
    ])

    wrapper.unmount()
  })

  it('keeps recovered-task quality notices without duplicating preview bodies in the workbench', async () => {
    setupNuxtGlobals()
    const taskId = '123e4567-e89b-12d3-a456-426614174000'
    const accepted: PaperTaskEvent = { type: 'accepted', taskId, selection: 'both' }
    const preview: PaperTaskEvent = {
      type: 'preview', taskId, branch: 'translation', designation: 'generated-preview',
      paragraphs: ['已保存的译文预览。'],
      quality: { status: 'needs-confirmation', issues: ['尚有原文问题'], options: ['inspect-source'] },
    }
    const terminal: PaperTaskEvent = {
      type: 'terminal', taskId, outcome: 'interrupted',
      branches: { translation: 'needs-confirmation', 'deep-reading': 'interrupted' }, cleanup: 'clean',
    }
    recoveryMock.historyResponse = [{
      taskId, sourceTitle: 'paper.pdf', createdAt: '2026-10-23T12:00:00.000Z',
      selection: 'both', status: 'interrupted',
      branches: { translation: 'needs-confirmation', 'deep-reading': 'interrupted' },
      fragments: [{
        taskId,
        branch: 'deep-reading',
        identity: `sha256:${'b'.repeat(64)}`,
        source: 'drafts/deep-reading/preview.md',
        reason: 'service-interrupted',
        quality: { status: 'needs-confirmation', issues: ['报告尚未完成'], options: ['inspect-source'] },
      }],
    }]
    recoveryMock.observationEvents = [accepted, preview, terminal]
    recoveryMock.observationResult = { kind: 'stream', outcome: { kind: 'terminal', terminal } }
    recoveryMock.readerState = {
      kind: 'loaded',
      view: { taskId, documents: [{ branch: 'translation' }] },
    }
    const wrapper = mountWorkbench()
    await flushPromises()

    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain('服务中断')
    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain(`sha256:${'b'.repeat(64)}`)
    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain('drafts/deep-reading/preview.md')
    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain('服务中断前保留')
    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain('报告尚未完成')
    await wrapper.get(`[data-testid="paper-task-history-open-${taskId}"]`).trigger('click')
    await flushPromises()

    expect(wrapper.get('.paper-task__result-title').text()).toContain('服务中断')
    expect(wrapper.get('.paper-task__status').text()).toContain('不会自动继续、重试或调用模型')
    expect(wrapper.text()).toContain('需确认')
    expect(wrapper.text()).toContain('尚有原文问题')
    expect(wrapper.text()).not.toContain('已保存的译文预览。')
    expect(wrapper.text()).not.toContain('任务中的译文预览片段。')
    expect(wrapper.find('.paper-task__preview').exists()).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === '进入专注阅读')).toBe(true)
    expect(recoveryMock.submitCalls).toBe(0)
    wrapper.unmount()
  })

  it('requires confirmation from both history and task details, and canceling leaves the task untouched', async () => {
    setupNuxtGlobals()
    installNativeDialogMethods()
    const taskId = '123e4567-e89b-12d3-a456-426614174000'
    recoveryMock.historyResponse = [{
      taskId,
      sourceTitle: 'paper.pdf',
      createdAt: '2026-10-23T12:00:00.000Z',
      selection: 'translation',
      status: 'success',
      branches: { translation: 'complete', 'deep-reading': 'not-selected' },
    }]
    const terminal: PaperTaskEvent = {
      type: 'terminal',
      taskId,
      outcome: 'succeeded',
      branches: { translation: 'complete', 'deep-reading': 'not-selected' },
      cleanup: 'clean',
    }
    recoveryMock.observationEvents = [{ type: 'accepted', taskId, selection: 'translation' }, terminal]
    recoveryMock.observationResult = { kind: 'stream', outcome: { kind: 'terminal', terminal } }
    const wrapper = mountWorkbench()
    await flushPromises()

    expect(wrapper.find(`[data-testid="paper-task-history-delete-${taskId}"]`).exists()).toBe(true)
    await wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="paper-task-delete-dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.get('[data-testid="paper-task-delete-dialog"]').text()).toContain('删除任务资料？')
    expect(wrapper.get('[data-testid="paper-task-delete-dialog"]').text()).toContain('paper.pdf')
    expect(wrapper.get('[data-testid="paper-task-delete-dialog"]').text()).toContain('其他位置的下载副本不会删除')
    expect(recoveryMock.deleteCalls).toEqual([])
    await wrapper.get('[data-testid="paper-task-delete-cancel"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([])
    expect(wrapper.text()).toContain('paper.pdf')

    await wrapper.get(`[data-testid="paper-task-history-open-${taskId}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="paper-task-delete"]').exists()).toBe(true)
    await wrapper.get('[data-testid="paper-task-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="paper-task-delete-dialog"]').text()).toContain('paper.pdf')
    expect(recoveryMock.deleteCalls).toEqual([])
    await wrapper.get('[data-testid="paper-task-delete-cancel"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([])

    await wrapper.get('[data-testid="paper-task-delete"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([])
    await wrapper.get('[data-testid="paper-task-delete-confirm"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([taskId])
    expect(wrapper.find('.paper-task__result').exists()).toBe(false)
    expect(wrapper.text()).toContain('尚无保留的任务记录')

    wrapper.unmount()
  })

  it('closes on Escape without deleting and restores focus to the initiating history action', async () => {
    setupNuxtGlobals()
    installNativeDialogMethods()
    const taskId = '123e4567-e89b-12d3-a456-426614174000'
    recoveryMock.historyResponse = [{
      taskId,
      sourceTitle: 'focus-paper.pdf',
      createdAt: '2026-10-23T12:00:00.000Z',
      selection: 'translation',
      status: 'success',
      branches: { translation: 'complete', 'deep-reading': 'not-selected' },
    }]
    const wrapper = mountWorkbench(document.body)
    await flushPromises()

    const opener = wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).element
    opener.focus()
    await wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-testid="paper-task-delete-dialog"]').element as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="paper-task-delete-cancel"]').element)

    dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(dialog.open).toBe(false)
    expect(recoveryMock.deleteCalls).toEqual([])
    expect(document.activeElement).toBe(opener)

    opener.focus()
    await wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="paper-task-delete-dialog"]').trigger('click')
    await flushPromises()
    expect(dialog.open).toBe(false)
    expect(recoveryMock.deleteCalls).toEqual([])
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })

  it('keeps a history record after cleanup failure and permits a confirmed retry', async () => {
    setupNuxtGlobals()
    installNativeDialogMethods()
    const taskId = '123e4567-e89b-12d3-a456-426614174000'
    recoveryMock.historyResponse = [{
      taskId,
      sourceTitle: 'retry-paper.pdf',
      createdAt: '2026-10-23T12:00:00.000Z',
      selection: 'translation',
      status: 'success',
      branches: { translation: 'complete', 'deep-reading': 'not-selected' },
      deletionPending: true,
    }]
    recoveryMock.deleteResponse = { ok: false, code: 'cleanup-failed' }
    const wrapper = mountWorkbench()
    await flushPromises()

    expect(wrapper.get('[data-testid="paper-task-history"]').text()).toContain('删除未完成，可重试')
    await wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([])
    await wrapper.get('[data-testid="paper-task-delete-confirm"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([taskId])
    expect(wrapper.text()).toContain('retry-paper.pdf')
    expect(wrapper.get('[data-testid="paper-task-history-error"]').text()).toContain('清理失败')

    recoveryMock.deleteResponse = { ok: true, code: 'deleted' }
    await wrapper.get(`[data-testid="paper-task-history-delete-${taskId}"]`).trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([taskId])
    await wrapper.get('[data-testid="paper-task-delete-confirm"]').trigger('click')
    await flushPromises()
    expect(recoveryMock.deleteCalls).toEqual([taskId, taskId])
    expect(wrapper.text()).not.toContain('retry-paper.pdf')
    expect(wrapper.text()).toContain('尚无保留的任务记录')

    wrapper.unmount()
  })

  it('shows editable provider fields and local-only destination, cost, and key handling disclosure', () => {
    setupNuxtGlobals()
    const wrapper = mount(PaperTaskApiSettings, {
      props: { returnTo: '/agents/paper' },
      global: { components: { NuxtLink: NuxtLinkStub } },
    })

    for (const id of [
      'paper-task-provider-label',
      'paper-task-provider-base-url',
      'paper-task-provider-protocol',
      'paper-task-provider-model',
      'paper-task-provider-api-key',
    ]) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    expect(wrapper.get('#paper-task-provider-api-key').attributes('type')).toBe('password')
    expect(wrapper.text()).toContain('发送内容与费用')
    expect(wrapper.text()).toContain('所选提供方')
    expect(wrapper.text()).toContain('由你承担')
    expect(wrapper.text()).toContain('仅保留在服务端内存')
    expect(wrapper.html()).not.toContain('secret-marker')
    expect(wrapper.get('.paper-task-api-settings__button--return').attributes('href')).toBe('/agents/paper')

    wrapper.unmount()
  })
})
