<template>
  <PaperReviewPageShell
    wide
    stamp="审阅"
    english="REVIEW REPORT"
    title="深读报告"
    description="单篇 PDF 的深读报告：按论断、方法、实验、证据、批评分节的连续长文，论断后带 [n] 引文编号，出处与逐字引文收纳于「出处与引文」；未覆盖范围与核验状态在二级披露中呈现，只展示已核验范围，不承诺完美的语义审阅。"
  >
    <section v-if="result === null" class="paper-review-no-result" data-testid="reader-no-result">
      <h2 class="paper-review-no-result__title">尚无深读报告</h2>
      <p class="paper-review-no-result__copy">
        直接访问本页或刷新后，当前浏览器会话不持有论文审阅结果。请返回工作台重新提交 PDF 后再查看报告。
      </p>
      <NuxtLink class="paper-review-no-result__link" :to="links.workbench">返回论文审阅工作台</NuxtLink>
    </section>

    <PaperReviewReader v-else :headings="rendered.headings">
      <template #masthead>
        <nav class="paper-review-reader-nav" aria-label="阅读器导航">
          <NuxtLink :to="links.workbench">返回工作台</NuxtLink>
          <NuxtLink :to="links.translation">查看全文译文</NuxtLink>
        </nav>
        <ReaderArticleHeader
          v-if="result !== null"
          :dossier="result"
          :pdf-url="pdfUrl"
          :pdf-name="pdfName"
          kind="report"
        />
      </template>

      <div class="paper-review-prose" data-testid="paper-review-report" v-html="rendered.html" />

      <template #secondary>
        <aside class="paper-review-secondary">
          <button class="paper-review-secondary__download" type="button" @click="downloadReport">
            下载 Markdown（.md）
          </button>

          <details v-if="sourcesHtml !== ''">
            <summary>出处与引文</summary>
            <div class="paper-review-secondary__content">
              <div class="paper-review-prose" v-html="sourcesHtml" />
            </div>
          </details>

          <details>
            <summary>未覆盖范围</summary>
            <div class="paper-review-secondary__content">
              <p v-if="gapsHtml === ''" class="paper-review-secondary__note">本次任务没有未覆盖范围。</p>
              <div v-else class="paper-review-prose" v-html="gapsHtml" />
            </div>
          </details>

          <details>
            <summary>核验状态</summary>
            <div class="paper-review-secondary__content">
              <div class="paper-review-prose" v-html="reviewHtml" />
            </div>
          </details>

          <details>
            <summary>技术细节（可选）</summary>
            <div class="paper-review-secondary__content">
              <div class="paper-review-prose" v-html="technicalHtml" />
            </div>
          </details>
        </aside>
      </template>
    </PaperReviewReader>
  </PaperReviewPageShell>
</template>

<script setup lang="ts">
import PaperReviewPageShell from '~/components/prototype/PaperReviewPageShell.vue'
import PaperReviewReader from '~/components/prototype/PaperReviewReader.vue'
import ReaderArticleHeader from '~/components/prototype/ReaderArticleHeader.vue'
import { usePaperReviewReaderLinks } from '~/composables/paper-review-links'
import { usePaperReviewSession } from '~/composables/paper-review-session'
import { paperReviewDownloadTextFile } from '~/utils/paper-review-download'
import { buildPaperReviewReportMarkdown } from '~/utils/paper-review-markdown'
import {
  buildPaperReviewGapsMarkdown,
  buildPaperReviewReportDownloadMarkdown,
  buildPaperReviewReportSourcesMarkdown,
  buildPaperReviewReviewMarkdown,
  buildPaperReviewTechnicalDetailsMarkdown,
  paperReviewDownloadFileName,
} from '~/utils/paper-review-markdown-secondary'
import { renderPaperReviewMarkdown } from '~/utils/paper-review-safe-render'

const EMPTY = { html: '', headings: [] }

const session = usePaperReviewSession()
const links = usePaperReviewReaderLinks()
const result = computed(() => session?.result.value ?? null)
const pdfUrl = computed(() => session?.pdfUrl.value ?? null)
const pdfName = computed(() => session?.pdfName.value ?? '论文')

const rendered = computed(() => {
  if (result.value === null) {
    return EMPTY
  }
  return renderPaperReviewMarkdown(buildPaperReviewReportMarkdown(result.value, pdfName.value), pdfUrl.value)
})

const sourcesHtml = computed(() => {
  if (result.value === null) {
    return ''
  }
  return renderPaperReviewMarkdown(buildPaperReviewReportSourcesMarkdown(result.value), pdfUrl.value).html
})

const gapsHtml = computed(() => {
  if (result.value === null) {
    return ''
  }
  const markdown = buildPaperReviewGapsMarkdown(result.value)
  return markdown === '' ? '' : renderPaperReviewMarkdown(markdown, pdfUrl.value).html
})

const reviewHtml = computed(() => {
  if (result.value === null) {
    return ''
  }
  return renderPaperReviewMarkdown(buildPaperReviewReviewMarkdown(result.value), pdfUrl.value).html
})

const technicalHtml = computed(() => {
  if (result.value === null) {
    return ''
  }
  return renderPaperReviewMarkdown(buildPaperReviewTechnicalDetailsMarkdown(result.value), pdfUrl.value).html
})

function downloadReport(): void {
  if (result.value === null) {
    return
  }
  const markdown = buildPaperReviewReportDownloadMarkdown(result.value, pdfName.value)
  paperReviewDownloadTextFile(paperReviewDownloadFileName(pdfName.value, 'report'), markdown)
}
</script>

<style scoped>
.paper-review-no-result {
  display: grid;
  justify-items: start;
  gap: 12px;
  padding: 40px 48px;
  border: 1px solid var(--rule);
  background-color: color-mix(in srgb, var(--paper-warm) 62%, transparent);
}

.paper-review-no-result__title {
  margin: 0;
  color: var(--ink);
  font: 700 22px/1.4 var(--font-mincho);
}

.paper-review-no-result__copy {
  margin: 0;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.8;
}

.paper-review-no-result__link {
  color: var(--vermilion);
  font-size: 15px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.paper-review-no-result__link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-review-secondary__download {
  justify-self: start;
  min-block-size: 44px;
  padding: 0 20px;
  border: 1px solid var(--vermilion);
  border-radius: 0;
  background: transparent;
  color: var(--vermilion);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}

.paper-review-secondary__download:hover {
  background-color: color-mix(in srgb, var(--sakura) 24%, transparent);
}

.paper-review-secondary__download:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}
</style>