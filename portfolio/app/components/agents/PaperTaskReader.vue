<template>
  <div class="paper-task-reader" data-testid="paper-task-reader" :data-task-id="currentView.taskId">
    <a class="paper-task-reader__skip" href="#paper-task-reader-manuscript" :inert="drawerOpen">跳到正文</a>

    <header ref="toolbar" class="paper-task-reader__toolbar" :inert="drawerOpen">
      <div class="paper-task-reader__toolbar-inner">
        <div class="paper-task-reader__toolbar-left">
          <button type="button" class="paper-task-reader__toolbar-button" @click="emit('close')">← 任务</button>
          <button
            v-if="headings.length > 0"
            id="paper-task-reader-toc-toggle"
            ref="tocTrigger"
            type="button"
            class="paper-task-reader__toolbar-button"
            :aria-expanded="drawerOpen"
            aria-controls="paper-task-reader-toc"
            @click="toggleDrawer"
          >
            章节目录
          </button>
        </div>

        <div class="paper-task-reader__toolbar-context">
          <span v-if="title !== ''" class="paper-task-reader__short-title" :title="title">{{ title }}</span>
          <span v-if="activeDocument !== null" class="paper-task-reader__progress-label" data-testid="paper-task-reader-progress-label">阅读进度 {{ readingProgress }}%</span>
          <span
            v-if="activeDocument !== null"
            class="paper-task-reader__progress-track"
            role="progressbar"
            aria-label="正文阅读进度"
            :aria-valuenow="readingProgress"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span class="paper-task-reader__progress-value" :style="{ inlineSize: `${readingProgress}%` }" />
          </span>
        </div>

        <div class="paper-task-reader__toolbar-actions">
          <span
            v-if="activeDocument?.branch === 'translation' && currentView.pdfs.translated.available"
            class="paper-task-reader__pdf-status"
            role="status"
            :title="currentView.pdfs.translated.message"
          >
            最终译文 PDF 已就绪
          </span>
          <button
            v-if="activeDocument?.branch === 'translation' && currentView.pdfs.translated.available"
            type="button"
            class="paper-task-reader__toolbar-button"
            @click="openPdf('translated')"
          >
            打开最终译文 PDF
          </button>
          <button
            type="button"
            class="paper-task-reader__toolbar-button paper-task-reader__original-action"
            :disabled="!currentView.pdfs.original.available"
            :title="currentView.pdfs.original.message"
            @click="openPdf('original')"
          >
            原论文 PDF ↗
          </button>
          <button
            v-if="activeDocument !== null"
            type="button"
            class="paper-task-reader__toolbar-button"
            :aria-label="activeDocument.status === 'fragment' ? '下载当前未完成片段 Markdown' : '下载当前 Markdown'"
            :title="downloadDescription"
            :data-fragment-id="activeDocument.status === 'fragment' ? activeDocument.fragment.identity : undefined"
            :data-fragment-reason="activeDocument.status === 'fragment' ? activeDocument.fragment.reason : undefined"
            :data-fragment-source="activeDocument.status === 'fragment' ? activeDocument.fragment.source : undefined"
            :data-fragment-source-label="activeDocument.status === 'fragment' ? paperTaskFragmentSourceLabel(activeDocument.fragment.source) : undefined"
            :data-fragment-quality="activeDocument.status === 'fragment' ? JSON.stringify(activeDocument.fragment.quality) : undefined"
            @click="downloadMarkdown"
          >
            {{ activeDocument.status === 'fragment' ? '下载未完成片段' : '下载 Markdown' }}
          </button>
        </div>
      </div>
    </header>

    <div class="paper-task-reader__layout">
      <main
        id="paper-task-reader-manuscript"
        ref="manuscript"
        class="paper-task-reader__manuscript"
        tabindex="-1"
        :inert="drawerOpen"
      >
        <nav v-if="renderedDocuments.length > 1" class="paper-task-reader__branch-switch" aria-label="成果切换">
          <button
            v-for="document in renderedDocuments"
            :key="document.branch"
            type="button"
            :aria-pressed="document.branch === activeBranch"
            :data-branch="document.branch"
            @click="selectBranch(document.branch)"
          >
            {{ paperTaskReaderDocumentLabel(document.branch, document.status) }}
          </button>
        </nav>

        <template v-if="activeDocument !== null">
          <header class="paper-task-reader__article-head">
            <p class="paper-task-reader__eyebrow">
              {{ paperTaskReaderDocumentLabel(activeDocument.branch, activeDocument.status) }} · {{ statusLabel(activeDocument.status) }}
            </p>
            <h1 class="paper-task-reader__title">
              {{ title === '' ? paperTaskReaderDocumentLabel(activeDocument.branch, activeDocument.status) : title }}
            </h1>
            <section
              v-if="activeDocument.status === 'fragment'"
              class="paper-task-reader__fragment"
              aria-label="未完成片段身份与来源"
              :data-fragment-id="activeDocument.fragment.identity"
              :data-fragment-reason="activeDocument.fragment.reason"
              :data-fragment-source="activeDocument.fragment.source"
            >
              <p class="paper-task-reader__fragment-designation">未完成片段 · 不代表完整主稿或最终 PDF</p>
              <dl>
                <dt>片段身份</dt><dd><code>{{ activeDocument.fragment.identity }}</code></dd>
                <dt>所属任务</dt><dd>{{ activeDocument.fragment.taskId }}</dd>
                <dt>所属分支</dt><dd>{{ paperTaskReaderDocumentLabel(activeDocument.fragment.branch, 'fragment') }}</dd>
                <dt>保存来源</dt><dd>{{ paperTaskFragmentSourceLabel(activeDocument.fragment.source) }} · <code>{{ activeDocument.fragment.source }}</code></dd>
                <dt>原因</dt><dd>{{ paperTaskFragmentReasonLabel(activeDocument.fragment.reason) }}</dd>
              </dl>
            </section>
          </header>

          <section
            v-if="activePreview !== undefined || activeQualityEntries.length > 0 || activeDocument.notice !== null"
            class="paper-task-reader__preview-context"
          >
            <details v-if="activePreview !== undefined && activePreview.paragraphs.length > 0" class="paper-task-reader__preview-excerpt">
              <summary>查看预览内容（{{ activePreview.paragraphs.length }} 段）</summary>
              <p v-for="(paragraph, index) in activePreview.paragraphs" :key="index">{{ paragraph }}</p>
            </details>
            <PaperTaskQualityPanel
              v-if="activeQualityEntries.length > 0 || activeDocument.notice !== null"
              :entries="activeQualityEntries"
              :notice="activeDocument.notice"
            />
          </section>

          <div ref="readingBody" class="paper-task-reader__body" v-html="activeDocument.html" />

          <footer class="paper-task-reader__article-footer">
            <p>到这里，阅读告一段落。</p>
            <button type="button" class="paper-task-reader__footer-button" @click="emit('close')">
              返回任务工作台
            </button>
          </footer>
        </template>

        <section v-else class="paper-task-reader__empty" aria-labelledby="paper-task-reader-empty-title">
          <h1 id="paper-task-reader-empty-title" class="paper-task-reader__title">暂无可读成果</h1>
          <p>当前任务没有可读取的 Markdown 成果；可返回工作台查看任务状态。</p>
          <button type="button" class="paper-task-reader__footer-button" @click="emit('close')">
            返回任务工作台
          </button>
        </section>

        <PaperTaskExportActions
          v-if="activeDocument !== null && activeDocument.status !== 'fragment'"
          :task-id="currentView.taskId"
          :document="activeDocument"
          @updated="updateView"
        />
      </main>

      <aside
        v-if="activeDocument !== null && tocItems.length > 0"
        class="paper-task-reader__toc-rail"
        data-testid="paper-task-reader-toc-rail"
      >
        <nav aria-label="文章章节">
          <p class="paper-task-reader__toc-rail-heading">文章章节</p>
          <ul>
            <li v-for="item in tocItems" :key="item.id">
              <a :href="`#${item.id}`" :aria-current="activeHeadingId === item.id ? 'location' : undefined" @click="handleTocNavigate($event, item.id)">{{ item.text }}</a>
              <ul v-if="item.children.length > 0">
                <li v-for="child in item.children" :key="child.id">
                  <a :href="`#${child.id}`" :aria-current="activeHeadingId === child.id ? 'location' : undefined" @click="handleTocNavigate($event, child.id)">{{ child.text }}</a>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </aside>
    </div>

    <div
      id="paper-task-reader-toc"
      ref="toc"
      class="paper-task-reader__toc"
      :class="{ 'paper-task-reader__toc--open': drawerOpen }"
      role="dialog"
      :aria-modal="drawerOpen ? 'true' : undefined"
      :aria-hidden="drawerOpen ? undefined : 'true'"
      :inert="!drawerOpen"
      aria-label="文章章节"
    >
      <nav aria-label="文章章节">
        <div class="paper-task-reader__toc-heading">
          <span>阅读导引</span>
          <small>CONTENTS</small>
          <button
            id="paper-task-reader-toc-close"
            ref="tocClose"
            type="button"
            class="paper-task-reader__toolbar-button"
            @click="closeDrawer()"
          >
            关闭目录
          </button>
        </div>
        <ul class="paper-task-reader__toc-links">
          <li v-for="item in tocItems" :key="item.id">
            <a :href="`#${item.id}`" :aria-current="activeHeadingId === item.id ? 'location' : undefined" @click="handleTocNavigate($event, item.id)">{{ item.text }}</a>
            <ul v-if="item.children.length > 0">
              <li v-for="child in item.children" :key="child.id">
                <a :href="`#${child.id}`" :aria-current="activeHeadingId === child.id ? 'location' : undefined" @click="handleTocNavigate($event, child.id)">{{ child.text }}</a>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </div>

    <button
      v-if="drawerOpen"
      type="button"
      class="paper-task-reader__backdrop"
      tabindex="-1"
      aria-label="关闭章节目录"
      @click="closeDrawer()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type WatchStopHandle } from 'vue'
import PaperTaskExportActions from '~/components/prototype/PaperTaskExportActions.vue'
import PaperTaskQualityPanel from '~/components/agents/PaperTaskQualityPanel.vue'
import type {
  PaperTaskReaderBranch,
  PaperTaskReaderDocumentStatus,
  PaperTaskReaderView,
} from '~/utils/paper-task-reader-contract'
import { paperTaskPdfPath } from '~/utils/paper-task-reader-contract'
import { paperTaskReaderDocumentLabel } from '~/utils/paper-task-reader-labels'
import { buildPaperTaskReaderToc } from '~/utils/paper-task-reader-toc'
import { renderPaperTaskReaderMarkdown } from '~/utils/paper-task-markdown'
import type { PaperTaskDesignation } from '~/utils/paper-task-contract'
import {
  paperTaskQualityOptionLabel,
  type PaperTaskQualityEntry,
} from '~/utils/paper-task-quality-summary'
import {
  paperTaskFragmentReasonLabel,
  paperTaskFragmentSourceLabel,
  paperTaskFragmentSourceToken,
} from '~/utils/paper-task-fragment-labels'
import {
  paperTaskSourceAssetIdSchema,
  paperTaskSourceAssetPath,
  paperTaskSourceTaskIdSchema,
} from '~/utils/paper-task-source-view'

interface Props {
  readonly view: PaperTaskReaderView
  readonly previewByBranch?: Partial<Record<PaperTaskReaderBranch, PaperTaskReaderPreview>>
  /** Development fixtures may map a controlled asset id to a local image. */
  readonly assetUrl?: (assetId: string) => string | null
}

interface PaperTaskReaderPreview {
  readonly headingLabel: string
  readonly badge: string
  readonly designation: PaperTaskDesignation
  readonly paragraphs: readonly string[]
  readonly issues: readonly string[]
  readonly options: readonly string[]
}

const props = defineProps<Props>()
const emit = defineEmits<{ readonly close: [] }>()
const currentView = ref(props.view)
watch(() => props.view, (view) => {
  if (view.taskId === currentView.value.taskId) currentView.value = view
})

const STATUS_LABELS: Record<PaperTaskReaderDocumentStatus, string> = {
  fragment: '未完成片段',
  preview: '未完成预览',
  'needs-confirmation': '需确认 · 保留可读内容',
  complete: '完整成品',
}

const renderedDocuments = computed(() => {
  const taskId = paperTaskSourceTaskIdSchema.safeParse(currentView.value.taskId)
  return currentView.value.documents.map((document) => {
    const urls = new Map<string, string>()
    if (taskId.success) {
      for (const asset of document.assets) {
        const assetId = paperTaskSourceAssetIdSchema.safeParse(asset.id)
        if (assetId.success) {
          urls.set(asset.id, props.assetUrl?.(asset.id)
            ?? paperTaskSourceAssetPath(taskId.data, assetId.data))
        }
      }
    }
    const rendered = renderPaperTaskReaderMarkdown(document.markdown, (assetId) => urls.get(assetId) ?? null)
    return {
      ...document,
      title: rendered.title ?? '',
      headings: rendered.headings,
      html: rendered.html,
    }
  })
})

const activeBranch = ref<PaperTaskReaderBranch | null>(renderedDocuments.value[0]?.branch ?? null)

watch(renderedDocuments, (documents) => {
  if (activeBranch.value === null || !documents.some((document) => document.branch === activeBranch.value)) {
    activeBranch.value = documents[0]?.branch ?? null
  }
})

const activeDocument = computed(() =>
  renderedDocuments.value.find((document) => document.branch === activeBranch.value) ?? null,
)
const title = computed(() => activeDocument.value?.title ?? '')
const headings = computed(() => activeDocument.value?.headings ?? [])
const tocItems = computed(() => buildPaperTaskReaderToc(headings.value))
const activePreview = computed(() => {
  const branch = activeDocument.value?.branch
  return branch === undefined ? undefined : props.previewByBranch?.[branch]
})
const activeQualityEntries = computed<readonly PaperTaskQualityEntry[]>(() => {
  const current = activeDocument.value
  if (current === null) return []

  const preview = activePreview.value
  const fragmentQuality = current.status === 'fragment' ? current.fragment.quality : null
  if (preview === undefined && current.status !== 'fragment') return []

  const statusLabel = current.status === 'fragment'
    && (fragmentQuality !== null || preview === undefined)
    ? qualityLabel(fragmentQuality?.status ?? null)
    : undefined

  return [{
    branch: current.branch,
    branchLabel: paperTaskReaderDocumentLabel(current.branch, current.status),
    headingLabel: '质量事项',
    badge: preview?.designation === 'sample' ? preview.badge : '',
    designation: preview?.designation ?? 'generated-preview',
    ...(statusLabel === undefined ? {} : { statusLabel }),
    issues: [
      ...(preview?.issues ?? []),
      ...(fragmentQuality?.issues ?? []),
    ],
    options: [
      ...(preview?.options ?? []),
      ...(fragmentQuality?.options.map(paperTaskQualityOptionLabel) ?? []),
    ],
  }]
})
const downloadDescription = computed(() => {
  const current = activeDocument.value
  if (current === null || current.status !== 'fragment') return '下载当前阅读分支的 Markdown 内容。'
  const quality = current.fragment.quality === null
    ? '无可恢复的质量记录'
    : `${current.fragment.quality.status}；问题 ${current.fragment.quality.issues.join('；') || '无'}；处理选项 ${current.fragment.quality.options.join('、') || '无'}`
  return `任务 ${current.fragment.taskId}；分支 ${current.fragment.branch}；原因 ${paperTaskFragmentReasonLabel(current.fragment.reason)}；质量 ${quality}；来源 ${paperTaskFragmentSourceLabel(current.fragment.source)} (${current.fragment.source})；身份 ${current.fragment.identity}`
})

const drawerOpen = ref(false)
const toc = ref<HTMLElement | null>(null)
const tocTrigger = ref<HTMLButtonElement | null>(null)
const tocClose = ref<HTMLButtonElement | null>(null)
const toolbar = ref<HTMLElement | null>(null)
const manuscript = ref<HTMLElement | null>(null)
const readingBody = ref<HTMLElement | null>(null)
const readingProgress = ref(0)
const activeHeadingId = ref<string | null>(headings.value[0]?.id ?? null)
let toolbarObserver: ResizeObserver | undefined
let stopActiveBranchWatch: WatchStopHandle | undefined
let stopActiveDocumentWatch: WatchStopHandle | undefined
let readingFrame: number | undefined
let mounted = false
let readingOffset = 104
let readingHeadings: HTMLElement[] = []

function statusLabel(status: PaperTaskReaderDocumentStatus): string {
  return STATUS_LABELS[status]
}

function selectBranch(branch: PaperTaskReaderBranch): void {
  activeBranch.value = branch
  closeDrawer(false)
}

function openPdf(kind: 'original' | 'translated'): void {
  if (kind === 'translated' && activeDocument.value?.branch !== 'translation') return
  const state = kind === 'original' ? currentView.value.pdfs.original : currentView.value.pdfs.translated
  if (!state.available) return
  const link = document.createElement('a')
  link.href = paperTaskPdfPath(currentView.value.taskId, kind, 'open')
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

function downloadMarkdown(): void {
  const currentDocument = activeDocument.value
  if (currentDocument === null) return

  const url = URL.createObjectURL(new Blob([currentDocument.markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = currentDocument.status === 'fragment'
    ? `${currentDocument.fragment.taskId}-${currentDocument.fragment.branch}-fragment-${paperTaskFragmentSourceToken(currentDocument.fragment.source)}-${currentDocument.fragment.reason}-${currentDocument.fragment.quality?.status ?? 'unknown'}-${currentDocument.fragment.identity.slice(7, 19)}.md`
    : `${currentView.value.taskId}-${currentDocument.branch}.md`
  if (currentDocument.status === 'fragment') {
    link.dataset.fragmentId = currentDocument.fragment.identity
    link.dataset.fragmentTaskId = currentDocument.fragment.taskId
    link.dataset.fragmentBranch = currentDocument.fragment.branch
    link.dataset.fragmentReason = currentDocument.fragment.reason
    link.dataset.fragmentQuality = JSON.stringify(currentDocument.fragment.quality)
    link.dataset.fragmentSource = currentDocument.fragment.source
    link.dataset.fragmentSourceLabel = paperTaskFragmentSourceLabel(currentDocument.fragment.source)
    link.dataset.fragmentSourceToken = paperTaskFragmentSourceToken(currentDocument.fragment.source)
  }
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function qualityLabel(status: 'preview' | 'needs-confirmation' | 'complete' | null): string {
  if (status === 'complete') return '预览声明完整，但仍是未完成片段'
  if (status === 'needs-confirmation') return '需确认'
  if (status === 'preview') return '未经最终发布检查的预览'
  return '无可恢复的质量记录'
}

function updateView(view: PaperTaskReaderView): void {
  if (view.taskId !== currentView.value.taskId) return
  currentView.value = view
}

function closeDrawer(restore = true): void {
  const wasOpen = drawerOpen.value
  drawerOpen.value = false
  if (wasOpen && restore) {
    void nextTick(() => tocTrigger.value?.focus({ preventScroll: true }))
  }
}

async function toggleDrawer(): Promise<void> {
  if (drawerOpen.value) {
    closeDrawer()
    return
  }
  drawerOpen.value = true
  await nextTick()
  tocClose.value?.focus({ preventScroll: true })
}

async function handleTocNavigate(event: MouseEvent, headingId: string): Promise<void> {
  event.preventDefault()
  closeDrawer(false)
  const target = document.getElementById(headingId)
  const reduceMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (target !== null && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  await nextTick()
  manuscript.value?.focus({ preventScroll: true })
}

function handleKeys(event: KeyboardEvent): void {
  if (!drawerOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDrawer()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = toc.value?.querySelectorAll<HTMLElement>('button, a[href]')
  const first = focusable?.[0]
  const last = focusable?.[focusable.length - 1]
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function updateReadingOffset(): void {
  readingOffset = Math.max(104, Math.ceil(toolbar.value?.getBoundingClientRect().height ?? 0))
  manuscript.value?.style.setProperty('--paper-task-reader-scroll-offset', `${readingOffset}px`)
}

function observeToolbar(): void {
  toolbarObserver?.disconnect()
  updateReadingOffset()
  if (toolbar.value !== null && typeof ResizeObserver !== 'undefined') {
    toolbarObserver = new ResizeObserver(() => {
      updateReadingOffset()
      scheduleReadingState()
    })
    toolbarObserver.observe(toolbar.value)
  }
}

function refreshReadingHeadings(): void {
  const body = readingBody.value
  if (body === null) {
    readingHeadings = []
    return
  }

  const selectedIds = new Set(headings.value.map((heading) => heading.id))
  readingHeadings = Array.from(body.querySelectorAll<HTMLElement>('h2[id], h3[id]'))
    .filter((heading) => selectedIds.has(heading.id))
}

function findCurrentHeading(): HTMLElement | undefined {
  let low = 0
  let high = readingHeadings.length - 1
  let currentIndex = -1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const heading = readingHeadings[middle]
    if (heading !== undefined && heading.getBoundingClientRect().top <= readingOffset) {
      currentIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return readingHeadings[currentIndex] ?? readingHeadings[0]
}

function updateReadingState(): void {
  readingFrame = undefined
  const body = readingBody.value
  const manuscriptElement = manuscript.value
  if (body === null || manuscriptElement === null) {
    readingProgress.value = 0
    activeHeadingId.value = null
    return
  }

  const bodyRect = body.getBoundingClientRect()
  const denominator = Math.max(1, bodyRect.height - window.innerHeight + readingOffset)
  readingProgress.value = bodyRect.height <= 0
    ? 0
    : Math.round(Math.min(1, Math.max(0, (readingOffset - bodyRect.top) / denominator)) * 100)

  activeHeadingId.value = findCurrentHeading()?.id ?? null
}

function scheduleReadingState(): void {
  if (!mounted || readingFrame !== undefined) return
  readingFrame = window.requestAnimationFrame(updateReadingState)
}

onMounted(() => {
  mounted = true
  observeToolbar()
  window.addEventListener('keydown', handleKeys)
  window.addEventListener('scroll', scheduleReadingState, { passive: true })
  window.addEventListener('resize', scheduleReadingState, { passive: true })
  stopActiveBranchWatch = watch(activeBranch, async () => {
    closeDrawer(false)
    await nextTick()
    observeToolbar()
    scheduleReadingState()
  })
  stopActiveDocumentWatch = watch(activeDocument, async () => {
    await nextTick()
    refreshReadingHeadings()
    scheduleReadingState()
  })
  refreshReadingHeadings()
  scheduleReadingState()
})

onBeforeUnmount(() => {
  mounted = false
  toolbarObserver?.disconnect()
  stopActiveBranchWatch?.()
  stopActiveDocumentWatch?.()
  window.removeEventListener('keydown', handleKeys)
  window.removeEventListener('scroll', scheduleReadingState)
  window.removeEventListener('resize', scheduleReadingState)
  if (readingFrame !== undefined) window.cancelAnimationFrame(readingFrame)
})
</script>

<style scoped src="~/assets/css/paper-task-reader.css"></style>

<style scoped>
/* v-html content does not receive the scoped attribute; target it explicitly. */
.paper-task-reader__body :deep(h2),
.paper-task-reader__body :deep(h3),
.paper-task-reader__body :deep(h4) {
  margin: 0;
  color: var(--ink);
  font-weight: 700;
  line-height: 1.5;
  scroll-margin-block-start: var(--paper-task-reader-scroll-offset, 104px);
}

.paper-task-reader__body :deep(h2) {
  margin-block: 58px 22px;
  padding-block-start: 18px;
  border-block-start: 1px solid var(--rule);
  font-size: 28px;
}

.paper-task-reader__body :deep(h3) {
  margin-block: 36px 14px;
  font-size: 21px;
}

.paper-task-reader__body :deep(h4) {
  margin-block: 28px 12px;
  font-size: 19px;
}

.paper-task-reader__body :deep(p),
.paper-task-reader__body :deep(li),
.paper-task-reader__body :deep(blockquote) {
  margin: 0 0 22px;
}

.paper-task-reader__body :deep(ul),
.paper-task-reader__body :deep(ol) {
  margin: 0 0 22px;
  padding-inline-start: 1.5rem;
}

.paper-task-reader__body :deep(blockquote) {
  padding-inline-start: 1.1rem;
  border-inline-start: 1px solid var(--rule);
  color: var(--ink-soft);
}

.paper-task-reader__body :deep(hr) {
  margin: 32px 0;
  border: 0;
  border-block-start: 1px dotted var(--rule);
}

.paper-task-reader__body :deep(a) {
  color: var(--ink);
  text-decoration-color: var(--rule);
  text-underline-offset: 4px;
}

.paper-task-reader__body :deep(img) {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
  margin: 30px 0;
  border: 1px solid var(--rule);
  background: color-mix(in srgb, var(--paper-warm) 40%, transparent);
}

.paper-task-reader__body :deep(code) {
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}

.paper-task-reader__body :deep(pre) {
  max-inline-size: 100%;
  overflow-x: auto;
  padding: 14px 16px;
  border-block: 1px dotted var(--rule);
  background: color-mix(in srgb, var(--paper-warm) 55%, transparent);
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre;
  overscroll-behavior: contain;
}

.paper-task-reader__body :deep(.paper-task-reader__table) {
  max-inline-size: 100%;
  margin: 30px 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
}

.paper-task-reader__body :deep(table) {
  border-collapse: collapse;
  inline-size: 100%;
  min-inline-size: 460px;
  font-size: 15px;
  text-align: start;
}

.paper-task-reader__body :deep(th),
.paper-task-reader__body :deep(td) {
  padding: 14px 10px;
  border-block-end: 1px solid var(--rule);
  white-space: nowrap;
}

.paper-task-reader__body :deep(th) {
  background: var(--paper-task-reader-wash);
  font-weight: 600;
}

.paper-task-reader__body :deep(.paper-task-reader__math) {
  font-size: 1em;
}

.paper-task-reader__body :deep(.paper-task-reader__math--block) {
  display: block;
  margin: 24px 0;
  padding: 24px 15px;
  background: var(--paper-task-reader-wash);
  text-align: center;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}

.paper-task-reader__body :deep(.paper-task-reader__math-fallback) {
  display: inline;
  color: var(--ink-soft);
  font-size: 0.82em;
  white-space: normal;
  overflow-wrap: anywhere;
}

.paper-task-reader__body :deep(.paper-task-reader__math-fallback code) {
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.paper-task-reader__body :deep(.paper-task-reader__math-fallback.paper-task-reader__math--block) {
  display: block;
  text-align: start;
}

@media (width < 768px) {
  .paper-task-reader__body :deep(h2) {
    font-size: 25px;
  }

  .paper-task-reader__body :deep(h3) {
    font-size: 20px;
  }
}
</style>
