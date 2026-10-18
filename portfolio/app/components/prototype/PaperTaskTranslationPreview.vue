<template>
  <article v-if="props.taskId !== null && props.ready" class="paper-task-translation" aria-labelledby="paper-task-translation-title">
    <header class="paper-task-translation__heading">
      <div class="paper-task-translation__title-row">
        <h3 id="paper-task-translation-title">翻译主稿</h3>
        <button type="button" class="paper-task-translation__refresh" @click="translation.refresh">
          重新读取主稿
        </button>
      </div>
      <p class="paper-task-translation__badge">{{ qualityBadge }}</p>
    </header>

    <p v-if="translationState.kind === 'loading'" class="paper-task-translation__note" role="status">
      正在读取完整翻译主稿…
    </p>
    <p v-else-if="translationState.kind === 'error'" class="paper-task-translation__note" role="note">
      完整主稿暂不可用；下方仅保留任务进度中收到的文本摘录。
    </p>

    <template v-else-if="translationState.kind === 'loaded'">
      <p
        v-if="translationState.view.status === 'needs-update'"
        class="paper-task-translation__notice"
        role="note"
      >
        原文修正后，依赖该记录的段落可能已过期；主稿保留修正前文字，未自动重译，未受影响的段落保持不变。
        <span v-if="staleSummary !== ''" class="paper-task-translation__stale">{{ staleSummary }}</span>
      </p>
      <p
        v-else-if="translationState.view.status === 'incomplete'"
        class="paper-task-translation__notice"
        role="note"
      >
        原文仍有缺失、无法恢复或未核实的内容；主稿保留可读文本，具体说明见下方。
      </p>
      <p v-else-if="props.qualityStatus === 'complete'" class="paper-task-translation__note">
        内容审阅与独立结构检查未发现未解决事项；这仍不等于逐句准确证明。
      </p>
      <p v-else class="paper-task-translation__note">
        受控结构检查未发现未解决材料；这不等于逐句准确或质量通过。
      </p>

      <ul v-if="translationState.view.unresolved.length > 0" class="paper-task-translation__unresolved" aria-label="未完成说明">
        <li v-for="item in translationState.view.unresolved" :key="item.recordId">
          {{ item.reason }}
        </li>
      </ul>

      <!-- Renderer output is allowlisted: raw HTML is disabled, only task-owned assets resolve. -->
      <div class="paper-task-translation__body" v-html="renderedHtml"></div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from 'vue'
import { usePaperTaskTranslation } from '~/composables/paper-task-translation'
import { renderPaperTaskTranslationMarkdown } from '~/utils/paper-task-markdown'
import {
  paperTaskSourceAssetIdSchema,
  paperTaskSourceAssetPath,
  paperTaskSourceTaskIdSchema,
} from '~/utils/paper-task-source-view'

interface Props {
  readonly taskId: string | null
  readonly ready: boolean
  readonly qualityStatus?: 'preview' | 'needs-confirmation' | 'complete'
}

const props = defineProps<Props>()
const emit = defineEmits<{ readonly loaded: [] }>()
const translation = usePaperTaskTranslation(toRef(props, 'taskId'), toRef(props, 'ready'))
const translationState = translation.state

const qualityBadge = computed(() => {
  switch (props.qualityStatus) {
    case 'complete':
      return '自然中文 Markdown · 内容审阅与结构检查通过'
    case 'needs-confirmation':
      return '自然中文 Markdown · 需确认 · 保留可读内容'
    default:
      return '自然中文 Markdown · 未完成预览 · 未经质量检查'
  }
})

const staleSummary = computed(() => {
  const current = translationState.value
  if (current.kind !== 'loaded' || current.view.staleParagraphs.length === 0) return ''
  return `可能过期的段落：${current.view.staleParagraphs.map((index) => index + 1).join('、')}。`
})

const renderedHtml = computed(() => {
  const current = translationState.value
  if (current.kind !== 'loaded') return ''
  const taskId = paperTaskSourceTaskIdSchema.safeParse(current.view.taskId)
  if (!taskId.success) return ''
  const urls = new Map<string, string>()
  for (const asset of current.view.assets) {
    const assetId = paperTaskSourceAssetIdSchema.safeParse(asset.id)
    if (assetId.success) urls.set(asset.id, paperTaskSourceAssetPath(taskId.data, assetId.data))
  }
  return renderPaperTaskTranslationMarkdown(current.view.markdown, (assetId) => urls.get(assetId) ?? null)
})

watch(
  () => translationState.value.kind,
  (kind) => {
    if (kind === 'loaded') emit('loaded')
  },
  { immediate: true },
)
</script>

<style scoped>
.paper-task-translation {
  display: grid;
  gap: 0.75rem;
  margin-block-start: 1.75rem;
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 1.25rem;
}

.paper-task-translation__heading {
  display: grid;
  gap: 0.35rem;
}

.paper-task-translation__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.paper-task-translation__refresh {
  min-block-size: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-mincho);
  font-size: 0.85rem;
  cursor: pointer;
}

.paper-task-translation__refresh:hover {
  border-color: var(--ink);
}

.paper-task-translation__refresh:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.paper-task-translation__heading h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-mincho);
  font-size: 1.25rem;
  font-weight: 600;
}

.paper-task-translation__badge {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.85rem;
  letter-spacing: 0.04em;
}

.paper-task-translation__note,
.paper-task-translation__notice,
.paper-task-translation__unresolved li {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.92rem;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.paper-task-translation__notice {
  border-inline-start: 1px solid var(--rule);
  padding-inline-start: 0.75rem;
  color: var(--ink);
}

.paper-task-translation__stale {
  display: block;
  margin-block-start: 0.25rem;
  color: var(--ink-soft);
}

.paper-task-translation__unresolved {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-inline-start: 1.1rem;
}

.paper-task-translation__body {
  max-inline-size: 74ch;
  color: var(--ink);
  font-family: var(--font-mincho);
  font-size: 1.02rem;
  line-height: 1.95;
  overflow-wrap: anywhere;
}

.paper-task-translation__body :deep(h1),
.paper-task-translation__body :deep(h2),
.paper-task-translation__body :deep(h3),
.paper-task-translation__body :deep(h4) {
  margin-block: 1.6em 0.6em;
  font-weight: 600;
  line-height: 1.4;
}

.paper-task-translation__body :deep(h1) {
  margin-block-start: 0.4em;
  font-size: 1.6rem;
}

.paper-task-translation__body :deep(h2) {
  font-size: 1.3rem;
}

.paper-task-translation__body :deep(h3) {
  font-size: 1.12rem;
}

.paper-task-translation__body :deep(p),
.paper-task-translation__body :deep(li),
.paper-task-translation__body :deep(blockquote) {
  margin-block: 0 1em;
}

.paper-task-translation__body :deep(ul),
.paper-task-translation__body :deep(ol) {
  padding-inline-start: 1.4rem;
}

.paper-task-translation__body :deep(blockquote) {
  border-inline-start: 1px solid var(--rule);
  padding-inline-start: 1rem;
  color: var(--ink-soft);
}

.paper-task-translation__body :deep(img) {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
  margin-block: 1rem;
  border: 1px solid var(--rule);
  background: var(--paper-warm);
}

.paper-task-translation__body :deep(hr) {
  border: 0;
  border-block-start: 1px dotted var(--rule);
  margin-block: 1.5rem;
}

.paper-task-translation__body :deep(a) {
  color: var(--ink);
  text-decoration-color: var(--rule);
  text-underline-offset: 0.2em;
}

.paper-task-translation__body :deep(a:focus-visible) {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}
</style>
