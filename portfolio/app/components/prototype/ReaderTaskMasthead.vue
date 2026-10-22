<template>
  <header data-testid="reader-task-masthead" class="reader-task-masthead">
    <div class="reader-task-masthead__head">
      <span class="reader-task-masthead__stamp">审阅</span>
      <p class="reader-task-masthead__eyebrow">PAPER REVIEW DOSSIER · 论文审阅档案</p>
      <h1 class="reader-task-masthead__title">{{ pdfName }}</h1>
      <p class="reader-task-masthead__lede">
        单篇 PDF 的深读报告与英中对照译文档案，按选定的档案导读（B）版式呈现。
      </p>
    </div>

    <dl
      v-if="pdfUrl !== null"
      class="reader-task-masthead__pdf-actions"
      aria-label="全文 PDF"
    >
      <div class="reader-task-masthead__pdf-action">
        <dt>打开</dt>
        <dd>
          <a :href="pdfUrl" target="_blank" rel="noopener">打开全文 PDF</a>
        </dd>
      </div>
      <div class="reader-task-masthead__pdf-action">
        <dt>下载</dt>
        <dd>
          <a :href="pdfUrl" :download="pdfName">下载 PDF</a>
        </dd>
      </div>
    </dl>

    <dl class="reader-task-masthead__facts">
      <div class="reader-task-masthead__fact">
        <dt>任务状态</dt>
        <dd>{{ readerTaskStatusLabel(dossier.status) }}</dd>
      </div>
      <div class="reader-task-masthead__fact">
        <dt>提供方</dt>
        <dd>{{ dossier.provider }}</dd>
      </div>
      <div class="reader-task-masthead__fact">
        <dt>模型</dt>
        <dd>{{ dossier.model }}</dd>
      </div>
      <div class="reader-task-masthead__fact">
        <dt>源页数</dt>
        <dd>{{ dossier.source.pageCount }} 页</dd>
      </div>
      <div class="reader-task-masthead__fact">
        <dt>核验</dt>
        <dd>{{ readerReviewStatusLabel(dossier.translation.review.status) }}</dd>
      </div>
    </dl>
  </header>
</template>

<script setup lang="ts">
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import { readerReviewStatusLabel, readerTaskStatusLabel } from './reader-dossier-labels'

interface Props {
  readonly dossier: PaperReviewTaskResult
  readonly pdfUrl: string | null
  readonly pdfName: string
}

defineProps<Props>()
</script>

<style scoped>
.reader-task-masthead {
  display: grid;
  gap: 32px;
  padding: 40px 48px 0;
  border: 1px solid var(--rule);
  background-color: color-mix(in srgb, var(--paper-warm) 62%, transparent);
}

.reader-task-masthead__head {
  display: grid;
  justify-items: center;
  gap: 16px;
  text-align: center;
}

.reader-task-masthead__stamp {
  display: inline-grid;
  place-items: center;
  min-inline-size: 44px;
  padding: 8px 6px;
  border: 2px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.6;
  writing-mode: vertical-rl;
}

.reader-task-masthead__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.reader-task-masthead__title {
  margin: 0;
  color: var(--ink);
  font: 700 clamp(24px, 3vw, 38px)/1.35 var(--font-mincho);
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.reader-task-masthead__lede {
  max-inline-size: 760px;
  margin: 0;
  color: var(--ink-soft);
  font-size: 16px;
  line-height: 1.8;
  text-wrap: balance;
}

.reader-task-masthead__pdf-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border-block-start: 1px dotted var(--rule);
}

.reader-task-masthead__pdf-action {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-block-end: 1px dotted var(--rule);
}

.reader-task-masthead__pdf-action dt {
  flex: none;
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.reader-task-masthead__pdf-action dd {
  margin: 0;
  text-align: end;
}

.reader-task-masthead__pdf-action a {
  color: var(--vermilion);
  font-size: 14px;
  line-height: 1.6;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.reader-task-masthead__pdf-action a:focus-visible,
.reader-task-masthead__facts a:focus-visible,
.reader-task-masthead__pdf-action a:hover {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.reader-task-masthead__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 32px;
  margin: 0;
  border-block-start: 1px dotted var(--rule);
}

.reader-task-masthead__fact {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-block-end: 1px dotted var(--rule);
}

.reader-task-masthead__fact dt {
  flex: none;
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.reader-task-masthead__fact dd {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  text-align: end;
  overflow-wrap: anywhere;
}

@media (width < 768px) {
  .reader-task-masthead {
    padding: 32px 24px 0;
  }

  .reader-task-masthead__pdf-actions,
  .reader-task-masthead__facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>