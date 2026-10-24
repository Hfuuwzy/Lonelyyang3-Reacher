// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaperTaskReaderView } from '../../app/utils/paper-task-reader-contract'
import type { PaperTaskFragment } from '../../app/utils/paper-task-contract'
import PaperTaskReader from '../../app/components/agents/PaperTaskReader.vue'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const FRAGMENT_ID = `sha256:${'a'.repeat(64)}`
const FRAGMENT_MARKDOWN = '# 保留的未完成片段\n\n这是任务分支文件中的实际内容。'

function formatState(fileName: string) {
  return {
    status: 'unbuilt' as const,
    build: 'unbuilt' as const,
    fileName,
    available: false,
    inspectionAvailable: false,
    finalAvailable: false,
    pages: [],
    blockers: [],
    boundaryVerified: false,
    message: '尚未构建。',
  }
}

function document(
  branch: 'translation' | 'deep-reading',
  status: 'preview' | 'needs-confirmation' | 'complete',
  markdown: string,
  notice: string | null = null,
) {
  return {
    branch,
    status,
    markdown,
    notice,
    assets: [],
    formats: {
      markdown: formatState(`${branch}.md`),
      assets: formatState(`${branch}-assets.zip`),
      pdf: formatState(`${branch}.pdf`),
    },
  }
}

function view(documents: PaperTaskReaderView['documents']): PaperTaskReaderView {
  return {
    taskId: TASK_ID,
    branches: { translation: 'preview-ready', 'deep-reading': 'needs-confirmation' },
    documents,
    pdfs: {
      original: { available: true, message: '原论文 PDF 可查看。' },
      translated: { available: false, message: '译文 PDF 尚未通过检查。' },
    },
  }
}

function fragmentDocument(fragment: PaperTaskFragment): PaperTaskReaderView['documents'][number] {
  return {
    branch: fragment.branch,
    status: 'fragment',
    notice: '这是任务分支已保存的未完成片段，不代表完整主稿。',
    markdown: FRAGMENT_MARKDOWN,
    assets: [],
    formats: {
      markdown: formatState(`${fragment.branch}-fragment.md`),
      assets: formatState(`${fragment.branch}-fragment-assets.zip`),
      pdf: formatState(`${fragment.branch}-fragment.pdf`),
    },
    fragment,
  }
}

const ExportActionsStub = defineComponent({
  props: { taskId: { type: String, required: true }, document: { type: Object, required: true } },
  setup: () => () => h('section', { 'data-testid': 'paper-task-export-actions' }, '格式与逐页检查状态'),
})

function mountReader(readerView: PaperTaskReaderView, attachTo?: Element) {
  return mount(PaperTaskReader, {
    props: {
      view: readerView,
      previewByBranch: {
        translation: {
          headingLabel: '译文预览',
          badge: '未完成预览',
          designation: 'generated-preview',
          paragraphs: ['任务中的译文预览片段。'],
          issues: ['原文表格仍需核对。'],
          options: ['核对原文材料'],
        },
        'deep-reading': {
          headingLabel: '深读预览',
          badge: '需确认',
          designation: 'generated-preview',
          paragraphs: ['任务中的报告预览片段。'],
          issues: ['报告保留了一项未核实推论。'],
          options: ['检查引用证据'],
        },
      },
    },
    ...(attachTo === undefined ? {} : { attachTo }),
    global: { stubs: { PaperTaskExportActions: ExportActionsStub } },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('formal paper-task reader', () => {
  it('keeps Markdown export available without offering a fake final PDF for a needs-confirmation translation', () => {
    const pending = view([document('translation', 'needs-confirmation', '# 待确认译文\n\n## 引言\n\n正文。')])
    const wrapper = mountReader({
      ...pending,
      branches: { translation: 'needs-confirmation', 'deep-reading': 'not-selected' },
    })
    expect(wrapper.find('.paper-task-reader__pdf-status').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('打开最终译文 PDF')
    expect(wrapper.get('button[aria-label="下载当前 Markdown"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('offers the final PDF only when the reader reports it as qualified', () => {
    const ready = view([document('translation', 'complete', '# 已确认译文\n\n## 引言\n\n正文。')])
    const wrapper = mountReader({
      ...ready,
      branches: { translation: 'complete', 'deep-reading': 'not-selected' },
      pdfs: {
        original: ready.pdfs.original,
        translated: { available: true, message: '译文 PDF 已通过检查。' },
      },
    })
    expect(wrapper.get('.paper-task-reader__pdf-status').text()).toBe('最终译文 PDF 已就绪')
    expect(wrapper.text()).toContain('打开最终译文 PDF')
    wrapper.unmount()
  })

  it('keeps task identity, branch quality and its persistent matching TOC with the real Markdown', async () => {
    const wrapper = mountReader(view([
      document('translation', 'preview', '# 全文译文\n\n## 引言\n\n译文完整正文。\n\n### 术语\n\n术语说明。'),
      document('deep-reading', 'needs-confirmation', '# 深读报告\n\n## 研究边界\n\n报告的真实正文。', '报告仍有需确认事项。'),
    ]))

    expect(wrapper.attributes('data-task-id')).toBe(TASK_ID)
    expect(wrapper.text()).not.toContain(TASK_ID)
    const context = wrapper.get('.paper-task-reader__toolbar-context')
    expect(context.text()).toContain('全文译文')
    expect(context.text()).not.toContain('译文草稿')
    expect(wrapper.find('h1').text()).toBe('全文译文')
    expect(wrapper.find('.paper-task-reader__body').text()).toContain('译文完整正文。')
    expect(wrapper.find('[data-testid="paper-task-reader-toc-rail"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="paper-task-reader-toc-rail"] a')).toHaveLength(2)
    expect(wrapper.find('[data-testid="paper-task-reader-toc-rail"] ul ul li a').text()).toBe('术语')
    expect(wrapper.text()).toContain('原文表格仍需核对。')
    expect(wrapper.text()).toContain('任务中的译文预览片段。')
    expect(wrapper.findAll('[data-testid="paper-task-quality-panel"]')).toHaveLength(1)
    const translationQuality = wrapper.get('[data-testid="paper-task-quality-panel"]')
    expect(translationQuality.get('[data-testid="paper-task-quality-critical"]').text()).toContain('表格／数值需核对')
    expect((translationQuality.get('[data-testid="paper-task-quality-details"]').element as HTMLDetailsElement).open).toBe(false)

    await wrapper.get('[data-branch="deep-reading"]').trigger('click')

    expect(wrapper.find('h1').text()).toBe('深读报告')
    expect(wrapper.find('.paper-task-reader__body').text()).toContain('报告的真实正文。')
    expect(wrapper.find('.paper-task-reader__notice').exists()).toBe(false)
    expect(wrapper.get('[data-testid="paper-task-quality-notice"]').text()).toContain('报告仍有需确认事项。')
    expect(wrapper.text()).toContain('报告保留了一项未核实推论。')
    expect(wrapper.text()).toContain('任务中的报告预览片段。')
    expect(wrapper.find('[data-testid="paper-task-reader-toc-rail"]').text()).toContain('研究边界')
    expect(wrapper.findAll('button').some(button => button.text().includes('打开译文 PDF'))).toBe(false)
    expect(wrapper.text()).toContain('原论文 PDF')

    wrapper.unmount()
  })

  it('navigates to the renderer-owned heading id without rewriting the current URL fragment', async () => {
    const wrapper = mountReader(view([
      document('translation', 'preview', '# 全文译文\n\n## 研究边界\n\n边界说明。'),
    ]))
    const originalHash = window.location.hash
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const heading = wrapper.find('.paper-task-reader__body h2')
    const link = wrapper.get('[data-testid="paper-task-reader-toc-rail"] a')

    expect(link.attributes('href')).toBe(`#${heading.attributes('id')}`)
    await link.trigger('click')

    expect(window.location.hash).toBe(originalHash)
    expect(replaceState).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('tracks the selected Markdown heading and visible reading progress across scroll and branch changes', async () => {
    const mountTarget = window.document.createElement('div')
    window.document.body.append(mountTarget)
    const wrapper = mountReader(view([
      document('translation', 'preview', '# 全文译文\n\n## 引言\n\n正文。\n\n### 这是一个较长但仍可完整阅读和聚焦的嵌套章节标题\n\n说明。'),
      document('deep-reading', 'needs-confirmation', '# 深读报告\n\n## 研究边界\n\n报告正文。'),
    ]), mountTarget)
    const toolbar = wrapper.get('.paper-task-reader__toolbar').element
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(rect(0, 132))
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })

    const body = wrapper.get('.paper-task-reader__body').element
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(-300, 1200))
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 1200 })
    const firstSection = wrapper.get('.paper-task-reader__body h2').element
    vi.spyOn(firstSection, 'getBoundingClientRect').mockReturnValue(rect(128, 40))
    const nestedSection = wrapper.get('.paper-task-reader__body h3').element
    vi.spyOn(nestedSection, 'getBoundingClientRect').mockReturnValue(rect(500, 40))

    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => window.setTimeout(resolve, 30))

    const currentLink = wrapper.get('[data-testid="paper-task-reader-toc-rail"] a[aria-current="location"]')
    expect(currentLink.text()).toBe('引言')
    expect(wrapper.get('[role="progressbar"][aria-label="正文阅读进度"]').attributes('aria-valuenow')).not.toBe('0')
    expect(wrapper.get('[data-testid="paper-task-reader-progress-label"]').text()).toMatch(/^阅读进度 \d+%$/u)
    const longLink = wrapper.get('[data-testid="paper-task-reader-toc-rail"] a[href="#这是一个较长但仍可完整阅读和聚焦的嵌套章节标题"]')
    longLink.element.focus()
    expect(documentActiveElement()).toBe(longLink.element)

    await wrapper.get('[data-branch="deep-reading"]').trigger('click')
    await new Promise(resolve => window.setTimeout(resolve, 30))
    const activeAfterBranchChange = wrapper.get('[data-testid="paper-task-reader-toc-rail"] a[aria-current="location"]')
    expect(activeAfterBranchChange.text()).toBe('研究边界')
    expect(wrapper.find('[data-testid="paper-task-reader-toc-rail"] a[href="#引言"]').exists()).toBe(false)

    wrapper.unmount()
    mountTarget.remove()
    delete (window as Window & { scrollY?: number }).scrollY
  })

  it('reuses cached heading elements across scroll frames and refreshes them when the branch changes', async () => {
    const mountTarget = window.document.createElement('div')
    window.document.body.append(mountTarget)
    const wrapper = mountReader(view([
      document('translation', 'preview', '# 全文译文\n\n## 引言\n\n正文。\n\n### 术语\n\n说明。'),
      document('deep-reading', 'needs-confirmation', '# 深读报告\n\n## 研究边界\n\n报告正文。'),
    ]), mountTarget)
    const body = wrapper.get('.paper-task-reader__body').element
    const queryHeadings = vi.spyOn(body, 'querySelectorAll')
    const headingQueries = () => queryHeadings.mock.calls.filter(([selector]) => selector === 'h2[id], h3[id]').length
    const settleFrame = () => new Promise(resolve => window.setTimeout(resolve, 30))

    await settleFrame()
    const initialHeadingQueries = headingQueries()
    expect(initialHeadingQueries).toBeLessThanOrEqual(1)

    for (let index = 0; index < 3; index++) {
      window.dispatchEvent(new Event('scroll'))
      await settleFrame()
    }
    expect(headingQueries()).toBe(initialHeadingQueries)

    await wrapper.get('[data-branch="deep-reading"]').trigger('click')
    await settleFrame()
    expect(headingQueries()).toBe(initialHeadingQueries + 1)

    window.dispatchEvent(new Event('scroll'))
    await settleFrame()
    expect(headingQueries()).toBe(initialHeadingQueries + 1)

    wrapper.unmount()
    mountTarget.remove()
  })

  it('downloads the currently selected task branch Markdown, not a sibling or an export preview', async () => {
    const createObjectURL = vi.fn(() => 'blob:current-paper-task-markdown')
    const revokeObjectURL = vi.fn()
    const NativeURL = globalThis.URL
    const TestURL = class extends NativeURL {}
    Object.defineProperties(TestURL, {
      createObjectURL: { value: createObjectURL },
      revokeObjectURL: { value: revokeObjectURL },
    })
    vi.stubGlobal('URL', TestURL)

    let clickedDownload = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clickedDownload = this.download
    })
    const translationMarkdown = '# 全文译文\n\n译文作者<sup>1,2</sup>与 H<sub>2</sub>O。'
    const deepReadingMarkdown = '# 深读报告\n\n报告主稿。'

    const wrapper = mountReader(view([
      document('translation', 'preview', translationMarkdown),
      document('deep-reading', 'needs-confirmation', deepReadingMarkdown),
    ]))

    const downloadButton = wrapper.find('button[aria-label="下载当前 Markdown"]')
    expect(downloadButton.exists()).toBe(true)
    await downloadButton.trigger('click')
    expect(clickedDownload).toBe(`${TASK_ID}-translation.md`)
    const firstBlob = createObjectURL.mock.calls[0]?.[0]
    expect(firstBlob).toBeInstanceOf(Blob)
    expect(await firstBlob?.text()).toBe(translationMarkdown)

    await wrapper.get('[data-branch="deep-reading"]').trigger('click')
    await downloadButton.trigger('click')
    expect(clickedDownload).toBe(`${TASK_ID}-deep-reading.md`)
    const secondBlob = createObjectURL.mock.calls[1]?.[0]
    expect(await secondBlob?.text()).toBe(deepReadingMarkdown)
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:current-paper-task-markdown')

    wrapper.unmount()
  })

  it('shows persisted fragment provenance and downloads the exact selected Markdown with a provenance-bearing filename', async () => {
    const createObjectURL = vi.fn(() => 'blob:paper-task-fragment')
    const NativeURL = globalThis.URL
    const TestURL = class extends NativeURL {}
    Object.defineProperty(TestURL, 'createObjectURL', { value: createObjectURL })
    vi.stubGlobal('URL', TestURL)
    let clickedAnchor: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clickedAnchor = this
    })

    const fragment: PaperTaskFragment = {
      taskId: TASK_ID,
      branch: 'translation',
      identity: FRAGMENT_ID,
      source: 'drafts/translation/preview.md',
      reason: 'branch-failed',
      quality: { status: 'needs-confirmation', issues: ['原文材料仍需核对。'], options: ['inspect-source'] },
    }
    const wrapper = mountReader(view([fragmentDocument(fragment)]))

    expect(wrapper.find('[data-fragment-id]').attributes('data-fragment-id')).toBe(FRAGMENT_ID)
    expect(wrapper.find('.paper-task-reader__fragment').text()).toContain(TASK_ID)
    expect(wrapper.find('.paper-task-reader__fragment').text()).toContain('drafts/translation/preview.md')
    expect(wrapper.find('.paper-task-reader__fragment').text()).toContain('分支失败')
    expect(wrapper.get('[data-testid="paper-task-quality-panel"]').text()).toContain('需确认')
    expect(wrapper.text()).toContain(FRAGMENT_MARKDOWN.split('\n\n')[1])
    expect(wrapper.find('[data-testid="paper-task-export-actions"]').exists()).toBe(false)
    expect(wrapper.find('.paper-task-reader__empty').exists()).toBe(false)

    await wrapper.get('button[aria-label="下载当前未完成片段 Markdown"]').trigger('click')
    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(await blob?.text()).toBe(FRAGMENT_MARKDOWN)
    expect(clickedAnchor?.download).toBe(`${TASK_ID}-translation-fragment-preview-branch-failed-needs-confirmation-${'a'.repeat(12)}.md`)
    expect(clickedAnchor?.dataset.fragmentId).toBe(FRAGMENT_ID)
    expect(clickedAnchor?.dataset.fragmentTaskId).toBe(TASK_ID)
    expect(clickedAnchor?.dataset.fragmentBranch).toBe('translation')
    expect(clickedAnchor?.dataset.fragmentReason).toBe('branch-failed')
    expect(clickedAnchor?.dataset.fragmentQuality).toBe(JSON.stringify(fragment.quality))
    expect(clickedAnchor?.dataset.fragmentSource).toBe('drafts/translation/preview.md')
    expect(clickedAnchor?.dataset.fragmentSourceLabel).toBe('译文预览镜像')
    expect(clickedAnchor?.dataset.fragmentSourceToken).toBe('preview')
    expect(wrapper.get('button[aria-label="下载当前未完成片段 Markdown"]').attributes('data-fragment-quality')).toBe(JSON.stringify(fragment.quality))
    expect(wrapper.get('button[aria-label="下载当前未完成片段 Markdown"]').attributes('data-fragment-source-label')).toBe('译文预览镜像')
    expect(wrapper.get('button[aria-label="下载当前未完成片段 Markdown"]').attributes('title')).toContain('原文材料仍需核对。')

    wrapper.unmount()
  })

  it('shows an honest no-readable-result state without switching to another task or demo', async () => {
    const wrapper = mountReader(view([]))

    expect(wrapper.text()).toContain('暂无可读成果')
    expect(wrapper.text()).toContain('没有可读取的 Markdown 成果')
    expect(wrapper.find('[data-testid="paper-task-reader-toc-rail"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="下载当前 Markdown"]').exists()).toBe(false)
    expect(wrapper.find('[role="progressbar"][aria-label="正文阅读进度"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('demo-paper-reading')

    await wrapper.get('.paper-task-reader__empty button').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })
})

function rect(top: number, height: number): DOMRect {
  return {
    x: 0, y: top, top, left: 0, right: 600, bottom: top + height,
    width: 600, height, toJSON: () => ({}),
  }
}

function documentActiveElement(): Element | null {
  return window.document.activeElement
}
