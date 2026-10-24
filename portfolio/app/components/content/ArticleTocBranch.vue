<template>
  <ol class="article-toc-branch" :class="{ 'article-toc-branch--nested': nested }">
    <li v-for="link in links" :key="link.id">
      <a
        :href="`#${link.id}`"
        :aria-current="activeId === link.id ? 'location' : undefined"
        :aria-expanded="link.children?.length ? containsActive(link) : undefined"
        :class="{ 'article-toc-branch__active-parent': activeId !== link.id && containsActive(link) }"
      >{{ link.text }}</a>
      <ArticleTocBranch
        v-if="link.children?.length && containsActive(link)"
        :links="link.children"
        :active-id="activeId"
        nested
      />
    </li>
  </ol>
</template>

<script setup lang="ts">
import type { ArticleTocLink } from '~/utils/article-toc'

const props = defineProps<{
  readonly links: readonly ArticleTocLink[]
  readonly activeId: string
  readonly nested?: boolean
}>()

function containsActive(link: ArticleTocLink): boolean {
  return link.id === props.activeId || (link.children?.some(containsActive) ?? false)
}
</script>

<style scoped>
.article-toc-branch {
  margin: 14px 0 0;
  padding: 0;
  counter-reset: chapter;
  list-style: none;
}

.article-toc-branch > li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 0 8px;
  padding: 7px 0;
  counter-increment: chapter;
}

.article-toc-branch > li::before {
  content: counter(chapter) ".";
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}

.article-toc-branch a {
  min-inline-size: 0;
  color: var(--ink-soft);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.article-toc-branch a:hover,
.article-toc-branch a[aria-current="location"] {
  color: var(--vermilion);
}

.article-toc-branch a[aria-current="location"] {
  font-weight: 600;
}

.article-toc-branch__active-parent {
  color: var(--ink) !important;
}

.article-toc-branch a:focus-visible {
  outline: 2px solid var(--vermilion);
  outline-offset: 3px;
}

.article-toc-branch--nested {
  grid-column: 2;
  margin-block-start: 8px;
  padding-inline-start: 10px;
  border-inline-start: 1px dotted var(--rule);
  font-size: 13px;
  line-height: 1.7;
}

.article-toc-branch--nested > li {
  display: block;
  padding: 5px 0;
}

.article-toc-branch--nested > li::before {
  content: none;
}

@media (width < 2360px) {
  .article-toc-branch:not(.article-toc-branch--nested) {
    display: flex;
    flex-wrap: wrap;
    gap: 0 24px;
  }

  .article-toc-branch:not(.article-toc-branch--nested) > li {
    flex: 1 1 180px;
    max-inline-size: 100%;
  }
}
</style>
