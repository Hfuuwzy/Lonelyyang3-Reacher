<template>
  <header data-testid="reader-article-header" class="reader-article-header">
    <p class="reader-article-header__eyebrow">{{ kindLabel }} · PAPER REVIEW</p>
    <h1 class="reader-article-header__title">{{ pdfName }}</h1>
    <p class="reader-article-header__meta">
      提供方 {{ dossier.provider }} · 模型 {{ dossier.model }} · 任务状态 {{ readerTaskStatusLabel(dossier.status) }}
    </p>
    <p v-if="pdfUrl !== null" class="reader-article-header__actions">
      <a :href="pdfUrl" target="_blank" rel="noopener">打开全文 PDF</a>
      <a :href="pdfUrl" :download="pdfName">下载 PDF</a>
    </p>
  </header>
</template>

<script setup lang="ts">
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import { readerTaskStatusLabel } from './reader-dossier-labels'

interface Props {
  readonly dossier: PaperReviewTaskResult
  readonly pdfUrl: string | null
  readonly pdfName: string
  readonly kind: 'report' | 'translation'
}

const props = defineProps<Props>()

const kindLabel = computed(() => (props.kind === 'report' ? '深读报告' : '全文译文'))
</script>

<style scoped>
.reader-article-header {
  display: grid;
  gap: 12px;
}

.reader-article-header__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.reader-article-header__title {
  margin: 0;
  color: var(--ink);
  font: 700 clamp(24px, 3vw, 36px)/1.4 var(--font-mincho);
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.reader-article-header__meta {
  margin: 0;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.reader-article-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 0;
  padding-block-start: 8px;
  border-block-start: 1px dotted var(--rule);
}

.reader-article-header__actions a {
  color: var(--vermilion);
  font-size: 14px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.reader-article-header__actions a:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}
</style>