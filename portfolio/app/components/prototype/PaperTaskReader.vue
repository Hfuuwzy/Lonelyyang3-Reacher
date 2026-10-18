<template>
  <div class="paper-task-reader" data-testid="paper-task-reader">
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
          <span>{{ activeDocument === null ? '阅读成果' : branchLabel(activeDocument.branch) }}</span>
          <span v-if="titlePassed && title !== ''" class="paper-task-reader__short-title" :title="title">{{ title }}</span>
        </div>

        <div class="paper-task-reader__toolbar-actions">
          <span class="paper-task-reader__pdf-status" role="status" :title="view.pdfs.translated.message">
            {{ view.pdfs.translated.available ? '译文 PDF 已就绪' : '译文 PDF 未就绪' }}
          </span>
          <button
            type="button"
            class="paper-task-reader__toolbar-button"
            :disabled="!view.pdfs.translated.available"
            @click="openPdf('translated', 'open')"
          >
            打开译文 PDF
          </button>
          <button
            type="button"
            class="paper-task-reader__toolbar-button"
            :disabled="!view.pdfs.translated.available"
            @click="openPdf('translated', 'download')"
          >
            下载译文 PDF
          </button>
          <button
            type="button"
            class="paper-task-reader__toolbar-button paper-task-reader__original-action"
            :disabled="!view.pdfs.original.available"
            @click="openPdf('original', 'open')"
          >
            原论文 ↗
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
            {{ branchLabel(document.branch) }}
          </button>
        </nav>

        <template v-if="activeDocument !== null">
          <header class="paper-task-reader__article-head">
            <p class="paper-task-reader__eyebrow">
              {{ branchLabel(activeDocument.branch) }} · {{ statusLabel(activeDocument.status) }}
            </p>
            <h1 ref="articleTitle" class="paper-task-reader__title">
              {{ title === '' ? branchLabel(activeDocument.branch) : title }}
            </h1>
            <p v-if="activeDocument.notice !== null" class="paper-task-reader__notice" role="status">
              {{ activeDocument.notice }}
            </p>
          </header>

          <div class="paper-task-reader__body" v-html="activeDocument.html" />

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
      </main>
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
        <div class="paper-task-reader__toc-links">
          <a
            v-for="heading in headings"
            :key="heading.id"
            :href="`#${heading.id}`"
            :data-depth="heading.depth"
            @click="handleTocNavigate($event, heading.id)"
          >
            {{ heading.text }}
          </a>
        </div>
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
import type {
  PaperTaskReaderBranch,
  PaperTaskReaderDocumentStatus,
  PaperTaskReaderView,
} from '~/utils/paper-task-reader-contract'
import { paperTaskPdfPath } from '~/utils/paper-task-reader-contract'
import { renderPaperTaskReaderMarkdown } from '~/utils/paper-task-markdown'
import {
  paperTaskSourceAssetIdSchema,
  paperTaskSourceAssetPath,
  paperTaskSourceTaskIdSchema,
} from '~/utils/paper-task-source-view'

interface Props {
  readonly view: PaperTaskReaderView
  /** Development fixtures may map a controlled asset id to a local image. */
  readonly assetUrl?: (assetId: string) => string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ readonly close: [] }>()

const BRANCH_LABELS: Record<PaperTaskReaderBranch, string> = {
  translation: '全文译文',
  'deep-reading': '深读报告',
}

const STATUS_LABELS: Record<PaperTaskReaderDocumentStatus, string> = {
  preview: '未完成预览',
  'needs-confirmation': '需确认 · 保留可读内容',
  complete: '完整成品',
}

const renderedDocuments = computed(() => {
  const taskId = paperTaskSourceTaskIdSchema.safeParse(props.view.taskId)
  return props.view.documents.map((document) => {
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

const drawerOpen = ref(false)
const toc = ref<HTMLElement | null>(null)
const tocTrigger = ref<HTMLButtonElement | null>(null)
const tocClose = ref<HTMLButtonElement | null>(null)
const toolbar = ref<HTMLElement | null>(null)
const manuscript = ref<HTMLElement | null>(null)
const articleTitle = ref<HTMLElement | null>(null)
const titlePassed = ref(false)
let titleObserver: IntersectionObserver | undefined
let toolbarObserver: ResizeObserver | undefined
let stopActiveBranchWatch: WatchStopHandle | undefined

function branchLabel(branch: PaperTaskReaderBranch): string {
  return BRANCH_LABELS[branch]
}

function statusLabel(status: PaperTaskReaderDocumentStatus): string {
  return STATUS_LABELS[status]
}

function selectBranch(branch: PaperTaskReaderBranch): void {
  activeBranch.value = branch
  closeDrawer(false)
}

function openPdf(kind: 'original' | 'translated', action: 'open' | 'download'): void {
  const state = kind === 'original' ? props.view.pdfs.original : props.view.pdfs.translated
  if (!state.available) return
  const link = document.createElement('a')
  link.href = paperTaskPdfPath(props.view.taskId, kind, action)
  if (action === 'download') {
    link.download = kind === 'original' ? 'original-paper.pdf' : 'translated-paper.pdf'
  } else {
    link.target = '_blank'
    link.rel = 'noopener'
  }
  document.body.append(link)
  link.click()
  link.remove()
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
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', `#${encodeURIComponent(headingId)}`)
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

function observeTitle(): void {
  titleObserver?.disconnect()
  const element = articleTitle.value
  if (element === null) return
  const height = toolbar.value?.getBoundingClientRect().height ?? 0
  titleObserver = new IntersectionObserver((entries) => {
    const entry = entries[0]
    if (entry !== undefined) titlePassed.value = entry.boundingClientRect.bottom <= height
  }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: [0, 1] })
  titleObserver.observe(element)
}

function observeToolbar(): void {
  toolbarObserver?.disconnect()
  observeTitle()
  if (toolbar.value !== null) {
    toolbarObserver = new ResizeObserver(observeTitle)
    toolbarObserver.observe(toolbar.value)
  }
}

onMounted(() => {
  observeToolbar()
  window.addEventListener('keydown', handleKeys)
  stopActiveBranchWatch = watch(activeBranch, async () => {
    closeDrawer(false)
    await nextTick()
    observeToolbar()
  })
})

onBeforeUnmount(() => {
  titleObserver?.disconnect()
  toolbarObserver?.disconnect()
  stopActiveBranchWatch?.()
  window.removeEventListener('keydown', handleKeys)
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
  scroll-margin-block-start: 140px;
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
  overscroll-behavior: contain;
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
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.95em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.paper-task-reader__body :deep(.paper-task-reader__math--block) {
  display: block;
  margin: 24px 0;
  padding: 24px 15px;
  background: var(--paper-task-reader-wash);
  text-align: center;
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
