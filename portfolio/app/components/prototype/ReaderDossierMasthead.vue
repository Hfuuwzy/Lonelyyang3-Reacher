<template>
  <header class="reader-dossier-masthead">
    <div class="reader-dossier-masthead__head">
      <span class="reader-dossier-masthead__stamp">研究备忘</span>
      <p class="reader-dossier-masthead__eyebrow">RESEARCH DOSSIER · 研究档案</p>
      <h1 class="reader-dossier-masthead__title">{{ page.title }}</h1>
      <p class="reader-dossier-masthead__lede">{{ page.description }}</p>
    </div>

    <dl class="reader-dossier-masthead__facts">
      <div class="reader-dossier-masthead__fact">
        <dt>快照日期</dt>
        <dd>{{ displayDate }}</dd>
      </div>
      <div class="reader-dossier-masthead__fact">
        <dt>分类</dt>
        <dd>{{ page.category }}</dd>
      </div>
      <div class="reader-dossier-masthead__fact">
        <dt>标签</dt>
        <dd>{{ tagsText }}</dd>
      </div>
    </dl>
  </header>
</template>

<script setup lang="ts">
import { formatDisplayDate } from '~/utils/articles'
import type { ResearchCollectionItem } from '@nuxt/content'

interface Props {
  readonly page: ResearchCollectionItem
}

const props = defineProps<Props>()

const displayDate = computed(() => formatDisplayDate(props.page.date, 'zh'))
const tagsText = computed(() => props.page.tags?.join(' / ') ?? '')
</script>

<style scoped>
.reader-dossier-masthead {
  display: grid;
  gap: 32px;
  padding: 40px 48px 0;
  border: 1px solid var(--rule);
  background-color: color-mix(in srgb, var(--paper-warm) 62%, transparent);
}

.reader-dossier-masthead__head {
  display: grid;
  justify-items: center;
  gap: 16px;
  text-align: center;
}

.reader-dossier-masthead__stamp {
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

.reader-dossier-masthead__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.reader-dossier-masthead__title {
  margin: 0;
  color: var(--ink);
  font: 700 clamp(30px, 3.6vw, 42px)/1.35 var(--font-mincho);
  text-wrap: balance;
}

.reader-dossier-masthead__lede {
  max-inline-size: 760px;
  margin: 0;
  color: var(--ink-soft);
  font-size: 16px;
  line-height: 1.8;
  text-wrap: balance;
}

.reader-dossier-masthead__facts {
  display: grid;
  margin: 0;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier-masthead__fact {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-block-end: 1px dotted var(--rule);
}

.reader-dossier-masthead__fact dt {
  flex: none;
  color: var(--ink-soft);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.reader-dossier-masthead__fact dd {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
  text-align: end;
}
</style>