// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PaperTaskWorkbench from '../../app/components/agents/PaperTaskWorkbench.vue'

const formalHarness = vi.hoisted(() => ({
  taskId: '123e4567-e89b-12d3-a456-426614174000',
  readerTaskId: null as string | null,
  scenario: 'success' as 'success' | 'mixed-failure',
}))

const MARKDOWN = {
  translation: '# 完整翻译主稿\n\n第一部分的真实正文。\n\n## 第二部分\n\n第二部分的完整正文。',
  'deep-reading': '# 深读报告\n\n报告的第一部分。\n\n## 研究边界\n\n报告的完整第二部分。',
} as const

vi.mock('../../app/composables/paper-task-workbench', async () => {
  const vue = await import('vue')
  return {
    usePaperTaskWorkbench: () => {
      const mixedFailure = formalHarness.scenario === 'mixed-failure'
      const tableIssue = '原文表 4 有 3 列，生成稿有 4 列；0.943 同时被标作 total F1 与 fake F1；原文缺失值被填入短横线。'
      return {
        pdfFile: vue.ref(null),
        sourceUrl: vue.ref('https://arxiv.org/abs/2404.05961'),
        sourceFallbackAvailable: vue.ref(false),
        providerSettingsRequired: vue.ref(false),
        history: vue.ref([]),
        historyLoading: vue.ref(false),
        historyError: vue.ref(''),
        observationFailed: vue.ref(false),
        selection: vue.ref('both'),
        phase: vue.ref('result'),
        taskId: vue.ref(formalHarness.taskId),
        actionPending: vue.ref(null),
        errorMessage: vue.ref(''),
        progressLabel: vue.ref('任务完成'),
        progressPercent: vue.ref(100),
        branchStates: vue.ref(mixedFailure
          ? { translation: 'needs-confirmation', 'deep-reading': 'failed' }
          : { translation: 'complete', 'deep-reading': 'needs-confirmation' }),
        terminalTitle: vue.ref(mixedFailure ? '任务失败' : '完整成品已就绪'),
        terminalSummary: vue.ref(mixedFailure
          ? '部分分支失败；可读预览与已保存资料保留在工作区中。'
          : '此任务的两个分支已结束。'),
        previewCards: vue.ref(mixedFailure ? [{
          branch: 'translation',
          designation: 'generated-preview',
          headingLabel: '译文预览',
          badge: '需确认 · 保留可读内容',
          paragraphs: ['保留的合成译文预览。'],
          quality: { status: 'needs-confirmation', issues: [tableIssue], options: ['inspect-source'] },
          issues: [tableIssue],
          options: ['核对原文材料'],
        }] : []),
        selectionOptions: vue.ref([
          { value: 'translation', label: '翻译' },
          { value: 'deep-reading', label: '深读' },
          { value: 'both', label: '两者' },
        ]),
        handleSubmit: async () => undefined,
        handleOpenHistory: async () => undefined,
        handleReconnect: async () => undefined,
        handleRefreshHistory: async () => undefined,
        handleCancel: async () => undefined,
        handleDelete: async () => undefined,
        handleResetError: () => undefined,
        branchLabel: (branch: string) => branch === 'translation' ? '翻译' : '深读',
        stateLabel: (state: string) => state === 'complete'
          ? '完整成品'
          : state === 'needs-confirmation' ? '需确认' : state === 'failed' ? '失败' : state,
      }
    },
  }
})

vi.mock('../../app/composables/paper-task-reader', async () => {
  const vue = await import('vue')
  return {
    usePaperTaskReader: (taskId: { readonly value: string | null }) => {
      formalHarness.readerTaskId = taskId.value
      return {
        state: vue.ref({
          kind: 'loaded',
          view: {
            taskId: formalHarness.taskId,
            branches: formalHarness.scenario === 'mixed-failure'
              ? { translation: 'needs-confirmation', 'deep-reading': 'failed' }
              : { translation: 'complete', 'deep-reading': 'needs-confirmation' },
            documents: formalHarness.scenario === 'mixed-failure'
              ? [{
                  branch: 'translation',
                  markdown: MARKDOWN.translation,
                  status: 'needs-confirmation',
                  notice: '翻译分支需确认，但保留了可读内容。',
                  assets: [],
                  formats: {},
                }]
              : [
                  { branch: 'translation', markdown: MARKDOWN.translation, status: 'complete', notice: null, assets: [], formats: {} },
                  { branch: 'deep-reading', markdown: MARKDOWN['deep-reading'], status: 'needs-confirmation', notice: '报告仍有需确认事项。', assets: [], formats: {} },
                ],
            pdfs: {
              original: { available: true, message: '原论文 PDF 可查看。' },
              translated: { available: false, message: '译文 PDF 尚未通过检查。' },
            },
          },
        }),
        refresh: async () => undefined,
      }
    },
  }
})

vi.mock('../../app/components/agents/PaperTaskReader.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: { view: { type: Object, required: true } },
      emits: ['close'],
      setup(props, { emit }) {
        return () => vue.h('section', {
          'data-testid': 'paper-task-reader-result',
          'data-task-id': props.view.taskId,
        }, [
          ...props.view.documents.map((document: { readonly branch: string; readonly markdown: string }) => vue.h('article', {
            'data-branch': document.branch,
          }, document.markdown)),
          vue.h('button', { onClick: () => emit('close') }, '返回任务工作台'),
        ])
      },
    }),
  }
})

function emptyTaskPanel() {
  return defineComponent({ setup: () => () => h('div') })
}

afterEach(() => {
  formalHarness.scenario = 'success'
  vi.unstubAllGlobals()
})

describe('formal paper-task reader flow', () => {
  it('opens this task’s full branch Markdown and returns to the same task context', async () => {
    formalHarness.scenario = 'success'
    vi.stubGlobal('useLocalePath', () => (path: string) => path)
    formalHarness.readerTaskId = null

    const wrapper = mount(PaperTaskWorkbench, {
      global: {
        components: { NuxtLink: defineComponent({ setup: () => () => h('a') }) },
        stubs: {
          PaperTaskSourceMaterials: emptyTaskPanel(),
        },
      },
    })
    await flushPromises()

    expect(formalHarness.readerTaskId).toBe(formalHarness.taskId)
    await wrapper.get('.paper-task__result button').trigger('click')

    const reader = wrapper.get('[data-testid="paper-task-reader-result"]')
    expect(reader.attributes('data-task-id')).toBe(formalHarness.taskId)
    expect(reader.find('[data-branch="translation"]').text()).toBe(MARKDOWN.translation)
    expect(reader.find('[data-branch="deep-reading"]').text()).toBe(MARKDOWN['deep-reading'])
    expect(reader.text()).not.toContain('其他任务')

    await reader.get('button').trigger('click')
    expect(wrapper.get('[data-testid="formal-paper-task-workbench"]').exists()).toBe(true)
    expect(wrapper.get('.paper-task__result-title').text()).toBe('完整成品已就绪')
    expect(wrapper.get('#paper-task-source-url').element.value).toBe('https://arxiv.org/abs/2404.05961')
    expect(wrapper.text()).toContain('需确认')

    wrapper.unmount()
  })

  it('labels mixed readable and failed branches as partial failure and keeps the readable branch openable', async () => {
    formalHarness.scenario = 'mixed-failure'
    vi.stubGlobal('useLocalePath', () => (path: string) => path)

    const wrapper = mount(PaperTaskWorkbench, {
      global: {
        components: { NuxtLink: defineComponent({ setup: () => () => h('a') }) },
        stubs: {
          PaperTaskSourceMaterials: emptyTaskPanel(),
        },
      },
    })
    await flushPromises()

    expect(wrapper.get('.paper-task__result-title').text()).toContain('部分分支失败')
    expect(wrapper.get('.paper-task__result-title').text()).not.toBe('任务失败')
    expect(wrapper.get('.paper-task__branch-states').text()).toContain('翻译需确认')
    expect(wrapper.get('.paper-task__branch-states').text()).toContain('深读失败')
    expect(wrapper.findAll('[data-testid="paper-task-quality-panel"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="paper-task-quality-critical"]').text()).toContain('表格／数值需核对')
    expect(wrapper.get('[data-testid="paper-task-quality-critical"]').text()).toContain('原文表 4 有 3 列')

    await wrapper.get('.paper-task__result button').trigger('click')
    const reader = wrapper.get('[data-testid="paper-task-reader-result"]')
    expect(reader.find('[data-branch="translation"]').text()).toBe(MARKDOWN.translation)
    expect(reader.find('[data-branch="deep-reading"]').exists()).toBe(false)

    wrapper.unmount()
    formalHarness.scenario = 'success'
  })
})
