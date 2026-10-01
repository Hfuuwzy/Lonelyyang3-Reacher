<template>
  <section data-testid="prototype-deepseek-reader" class="deepseek-reader-page">
    <PaperSectionHeading
      stamp="原型"
      english="DEEPSEEK READER"
      title="DeepSeek 档案导读阅读原型"
      description="已选定的档案导读（B）版式：左侧章节导读轨 + 版心居中正文，共用同一篇研究笔记。仅验收桌面与中文。"
    />

    <p class="deepseek-reader-page__scope">
      本页为布局原型：已选定档案导读（B）桌面中文版式，共用同一篇 <code>/research</code> 研究笔记，正文一律经 <code>ArticleProse</code> 渲染，不另写解析器。
    </p>

    <PrototypeReaderGuided v-if="page" :page="page" />
    <p v-else class="deepseek-reader-page__missing">研究笔记不存在。</p>

  </section>
</template>

<script setup lang="ts">
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'

definePageMeta({ layout: 'default' })

const { data: researchData } = await useAsyncData('deepseek-research-page', () => queryCollection('research').first())
const page = computed(() => researchData.value)
</script>

<style scoped>
.deepseek-reader-page {
  display: grid;
  gap: 40px;
  padding: 64px clamp(32px, 8vw, 96px) 160px;
  background-color: var(--paper);
  background-image: var(--paper-surface-depth);
  background-blend-mode: var(--paper-surface-blend);
  text-shadow: var(--ink-impression);
}

.deepseek-reader-page__scope {
  max-inline-size: 760px;
  margin: 0 auto;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.deepseek-reader-page__scope code {
  color: var(--vermilion);
}

.deepseek-reader-page__missing {
  max-inline-size: 760px;
  margin: 0 auto;
  color: var(--ink-soft);
  font-size: 16px;
}

/* 原型内 Q&A 摘要表：固定布局，首列让出 36%，避免问题短语被换行拆散。仅本页生效。 */
.deepseek-reader-page :deep(.article-prose table) {
  table-layout: fixed;
}

.deepseek-reader-page :deep(.article-prose th:first-child),
.deepseek-reader-page :deep(.article-prose td:first-child) {
  inline-size: 36%;
}
</style>
