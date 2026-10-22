<template>
  <div data-testid="paper-review-reader" class="paper-review-reader">
    <nav class="paper-review-reader__guide" aria-label="章节导航">
      <p class="paper-review-reader__guide-label">章节</p>
      <ol class="paper-review-reader__guide-list">
        <li v-for="link in tocLinks" :key="link.id">
          <a :href="`#${link.id}`">{{ link.text }}</a>
        </li>
      </ol>
    </nav>

    <div class="paper-review-reader__column">
      <slot name="masthead" />
      <slot />
      <slot name="secondary" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PaperReviewRenderedHeading } from '~/utils/paper-review-safe-render'

interface Props {
  readonly headings: readonly PaperReviewRenderedHeading[]
}

const props = defineProps<Props>()

// Reader rail lists the section-level headings (depth 2), matching the B
// variant's chapter navigation contract.
const tocLinks = computed(() => props.headings.filter((heading) => heading.depth === 2))
</script>

<style scoped>
/* Reuses the B-shell geometry: wide desktop keeps a sticky guide rail in the
   left symmetric track, the 760px reading column stays independently centered,
   and <1600px the rail becomes a horizontal chapter bar above the column. */
.paper-review-reader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 760px) minmax(0, 1fr);
  column-gap: clamp(32px, 4vw, 64px);
  align-items: start;
}

.paper-review-reader__guide {
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

.paper-review-reader__guide-label {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.paper-review-reader__guide-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0 0 0 16px;
  border-inline-start: 1px dotted var(--rule);
  list-style: none;
}

.paper-review-reader__guide-list a {
  display: block;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.5;
  text-decoration: none;
}

.paper-review-reader__guide-list a:hover {
  color: var(--vermilion);
}

.paper-review-reader__guide-list a:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-review-reader__column {
  grid-column: 2;
  display: grid;
  min-inline-size: 0;
  gap: 40px;
}

/* —— 阅读器导航：工作台 / 深读报告 / 全文译文互达 —— */
.paper-review-reader :deep(.paper-review-reader-nav) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.paper-review-reader :deep(.paper-review-reader-nav a) {
  color: var(--vermilion);
  font-size: 14px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.paper-review-reader :deep(.paper-review-reader-nav a:focus-visible) {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

/* —— 连续 Markdown 正文：和纸墨色衬线排版，无卡片、无逐单元印章 —— */
.paper-review-reader :deep(.paper-review-prose) {
  font-family: "Noto Serif SC", "Noto Serif JP", "Songti SC", serif;
  font-weight: 400;
  font-size: 17px;
  line-height: 1.8;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.paper-review-reader :deep(.paper-review-prose h2),
.paper-review-reader :deep(.paper-review-prose h3),
.paper-review-reader :deep(.paper-review-prose h4) {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-mincho);
  font-weight: 700;
  line-height: 1.4;
  scroll-margin-block-start: 24px;
}

.paper-review-reader :deep(.paper-review-prose h2) {
  margin-block-start: 40px;
  font-size: 22px;
}

.paper-review-reader :deep(.paper-review-prose h3) {
  margin-block-start: 32px;
  font-size: 19px;
}

.paper-review-reader :deep(.paper-review-prose h4) {
  margin-block-start: 24px;
  font-size: 17px;
}

.paper-review-reader :deep(.paper-review-prose > h2:first-child) {
  margin-block-start: 0;
}

.paper-review-reader :deep(.paper-review-prose p) {
  margin: 0 0 20px;
}

.paper-review-reader :deep(.paper-review-prose strong) {
  font-weight: 600;
}

.paper-review-reader :deep(.paper-review-prose a) {
  color: var(--vermilion);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.paper-review-reader :deep(.paper-review-prose a:focus-visible) {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-review-reader :deep(.paper-review-prose blockquote) {
  margin: 0 0 20px;
  padding: 10px 0 10px 18px;
  border-inline-start: 2px solid var(--rule);
  color: var(--ink);
  font-size: 15px;
  white-space: pre-wrap;
}

.paper-review-reader :deep(.paper-review-prose blockquote p) {
  margin: 0;
}

.paper-review-reader :deep(.paper-review-prose ul),
.paper-review-reader :deep(.paper-review-prose ol) {
  margin: 0 0 20px;
  padding-inline-start: 28px;
}

.paper-review-reader :deep(.paper-review-prose li) {
  margin-block-end: 8px;
}

.paper-review-reader :deep(.paper-review-prose hr) {
  margin: 32px 0;
  border: 0;
  border-block-start: 1px dotted var(--rule);
}

.paper-review-reader :deep(.paper-review-prose code) {
  color: var(--vermilion);
  font-family: var(--font-mincho);
  font-size: 0.92em;
}

/* —— 保留原文（公式/表格）的惰性代码区：等宽、可横向滚动、不套衬线栏 —— */
.paper-review-reader :deep(.paper-review-prose pre) {
  margin: 0 0 20px;
  padding: 14px 16px;
  border-block-start: 1px dotted var(--rule);
  border-block-end: 1px dotted var(--rule);
  background-color: color-mix(in srgb, var(--paper-warm) 55%, transparent);
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink);
  /* Nowrap preserved source: real table rows keep their line breaks and the
     block scrolls horizontally instead of wrapping or growing the column. */
  white-space: pre;
  overflow-wrap: normal;
  max-inline-size: 100%;
  overflow-x: auto;
  tab-size: 4;
}

.paper-review-reader :deep(.paper-review-prose pre code) {
  color: var(--ink);
  font-family: inherit;
  font-size: 1em;
  white-space: pre;
  tab-size: 4;
}

/* —— 次级披露：下载、核验状态、未覆盖范围、英文原文对照 —— */
.paper-review-reader :deep(.paper-review-secondary) {
  display: grid;
  gap: 16px;
  padding-block-start: 32px;
  border-block-start: 1px dotted var(--rule);
}

.paper-review-reader :deep(.paper-review-secondary details) {
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 14px;
}

.paper-review-reader :deep(.paper-review-secondary summary) {
  color: var(--ink);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.7;
}

.paper-review-reader :deep(.paper-review-secondary summary:focus-visible) {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-review-reader :deep(.paper-review-secondary__content) {
  display: grid;
  gap: 12px;
  padding-block-start: 12px;
}

.paper-review-reader :deep(.paper-review-secondary__content .paper-review-prose) {
  font-size: 15px;
}

.paper-review-reader :deep(.paper-review-secondary__note) {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

/* 窄桌面：导读轨退化为正文栏上方的横向章节条，正文栏保持独立居中。 */
@media (width < 1600px) {
  .paper-review-reader {
    grid-template-columns: minmax(0, 760px);
    justify-content: center;
    row-gap: 24px;
    column-gap: 0;
  }

  .paper-review-reader__guide {
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

  .paper-review-reader__guide-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    padding: 0;
    border-inline-start: 0;
  }

  .paper-review-reader__column {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>