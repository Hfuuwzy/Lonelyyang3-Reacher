<template>
  <div data-testid="variant-reader-b" class="reader-guided">
    <nav class="reader-guided__guide" aria-label="章节导航">
      <p class="reader-guided__guide-label">章节</p>
      <ol class="reader-guided__guide-list">
        <li v-for="link in tocLinks" :key="link.id">
          <a :href="`#${link.id}`">{{ link.text }}</a>
        </li>
      </ol>
    </nav>

    <div class="reader-guided__column">
      <PrototypeReaderDossierMasthead v-if="page" :page="page" />
      <PrototypeReaderTaskMasthead
        v-else-if="dossier"
        :dossier="dossier"
        :pdf-url="pdfUrl"
        :pdf-name="pdfName ?? '论文'"
      />
      <ArticleProse v-if="page" :value="page" />
      <PrototypeReaderDossier
        v-else-if="dossier"
        :dossier="dossier"
        :pdf-url="pdfUrl"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ArticleProse from '~/components/content/ArticleProse.vue'
import type { ResearchCollectionItem } from '@nuxt/content'
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import { readerDossierTocLinks } from './reader-dossier-views'

interface Props {
  readonly page?: ResearchCollectionItem | null
  readonly dossier?: PaperReviewTaskResult | null
  readonly pdfUrl?: string | null
  readonly pdfName?: string
}

const props = defineProps<Props>()

// 静态研究笔记：Nuxt Content 在 SSR 阶段生成的目录，id/text 与内容渲染器产出的
// 标题锚点一致，因此链接在直接 hash 加载时即可定位，无需在挂载后改写标题 id。
// 生成档案：由应用持有的任务结果构建章节目录，不经 ContentRenderer。
const tocLinks = computed(() => {
  if (props.page) {
    return props.page.body?.toc?.links?.filter((link) => link.depth === 2) ?? []
  }
  if (props.dossier) {
    return readerDossierTocLinks(props.dossier)
  }
  return []
})
</script>

<style scoped>
/* 宽桌面：粘性导读轨位于左侧轨道，正文栏由对称的 1fr/760px/1fr 网格轨道独立居中，
   与 A 的 margin-inline: auto 落在同一内容轴上。*/
.reader-guided {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 760px) minmax(0, 1fr);
  column-gap: clamp(32px, 4vw, 64px);
  align-items: start;
}

.reader-guided__guide {
  grid-column: 1;
  justify-self: end;
  position: sticky;
  inset-block-start: 32px;
  display: grid;
  gap: 12px;
  padding-block-start: 8px;
  width: 260px;
  min-inline-size: 0;
}

.reader-guided__guide-label {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.reader-guided__guide-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0 0 0 16px;
  border-inline-start: 1px dotted var(--rule);
  list-style: none;
}

.reader-guided__guide-list a {
  display: block;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.5;
  text-decoration: none;
}

.reader-guided__guide-list a:hover {
  color: var(--vermilion);
}

.reader-guided__guide-list a:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.reader-guided__column {
  grid-column: 2;
  display: grid;
  min-inline-size: 0;
  gap: 40px;
}

/* —— B 变体专属排版：中文优先衬线/字重体系（依据 deaimon.jp 实测特征）。
   只作用于 B 变体内的正文，不改全局 article-prose 规则。*/
.reader-guided :deep(.article-prose) {
  font-family: "Noto Serif SC", "Noto Serif JP", "Songti SC", serif;
  font-weight: 400;
}

.reader-guided :deep(.article-prose h2),
.reader-guided :deep(.article-prose h3),
.reader-guided :deep(.article-prose h4) {
  font-weight: 700;
}

.reader-guided :deep(.article-prose strong) {
  font-weight: 600;
}

/* 窄桌面：左侧轨道不足以容纳导读轨时，改为正文栏上方的横向章节条，
   正文栏保持独立居中、不位移。*/
@media (width < 1600px) {
  .reader-guided {
    grid-template-columns: minmax(0, 760px);
    justify-content: center;
    row-gap: 24px;
    column-gap: 0;
  }

  .reader-guided__guide {
    grid-column: 1;
    grid-row: 1;
    position: static;
    inset-block-start: auto;
    justify-self: stretch;
    width: auto;
    grid-template-columns: auto 1fr;
    gap: 12px;
    padding-block-start: 0;
  }

  .reader-guided__guide-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    padding: 0;
    border-inline-start: 0;
  }

  .reader-guided__column {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>