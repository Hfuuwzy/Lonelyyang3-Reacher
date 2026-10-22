<template>
  <section class="paper-review-summary" data-testid="paper-review-summary">
    <header class="paper-review-summary__head">
      <p class="paper-review-summary__eyebrow">RESULT · 审阅结果</p>
      <h2 class="paper-review-summary__title">{{ pdfName }}</h2>
      <p class="paper-review-summary__status" :data-status="result.status">
        {{ readerTaskStatusLabel(result.status) }} · 提供方 {{ result.provider }} · 模型 {{ result.model }}
      </p>
    </header>

    <nav class="paper-review-summary__actions" aria-label="阅读入口">
      <NuxtLink class="paper-review-summary__link paper-review-summary__link--primary" :to="links.report">
        查看深读报告
      </NuxtLink>
      <NuxtLink class="paper-review-summary__link" :to="links.translation">
        查看全文译文
      </NuxtLink>
      <a
        v-if="pdfUrl !== null"
        class="paper-review-summary__link"
        :href="pdfUrl"
        target="_blank"
        rel="noopener"
      >打开全文 PDF</a>
      <a
        v-if="pdfUrl !== null"
        class="paper-review-summary__link"
        :href="pdfUrl"
        :download="pdfName"
      >下载 PDF</a>
    </nav>

    <details class="paper-review-summary__secondary">
      <summary>原文来源 · 核验状态 · 未覆盖范围</summary>
      <div class="paper-review-summary__secondary-body">
        <p v-if="exclusionScope !== ''" class="paper-review-summary__note">{{ exclusionScope }}</p>

        <p class="paper-review-summary__note">
          核验状态：{{ reviewStatusLine }}。模型对照复检：检查遗漏、术语、数字、否定关系；通过不等于人工审校。
        </p>

        <ul v-if="gapGroups.length > 0" class="paper-review-summary__gaps">
          <li v-for="group in gapGroups" :key="`${group.artifact}-${group.code}`" class="paper-review-summary__gap">
            <span class="paper-review-summary__artifact">[{{ group.artifactLabel }}]</span>
            <span>{{ group.action }}</span>
            <span v-if="group.pageText !== ''">{{ group.pageText }}</span>
            <span v-if="group.headings.length > 0">{{ group.headings.join('、') }}</span>
            <span v-if="group.unitCount > 1">（{{ group.unitCount }} 个单元）</span>
          </li>
        </ul>
        <p v-else class="paper-review-summary__note">本次任务没有未覆盖范围。</p>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import {
  paperReviewHumanGapGroups,
  paperReviewReviewStatusLine,
} from '~/utils/paper-review-gaps'
import { readerExclusionScopeText, readerTaskStatusLabel } from '~/components/prototype/reader-dossier-labels'
import { usePaperReviewReaderLinks } from '~/composables/paper-review-links'

interface Props {
  readonly result: PaperReviewTaskResult
  readonly pdfName: string
  readonly pdfUrl: string | null
}

const props = defineProps<Props>()
const links = usePaperReviewReaderLinks()

const reviewStatusLine = computed(() => paperReviewReviewStatusLine(props.result.translation.review))
const exclusionScope = computed(() => readerExclusionScopeText(props.result.source.units))
const gapGroups = computed(() => paperReviewHumanGapGroups(props.result.gaps, props.result.source.units))
</script>

<style scoped>
.paper-review-summary {
  display: grid;
  gap: 24px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.paper-review-summary__head {
  display: grid;
  gap: 10px;
}

.paper-review-summary__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
}

.paper-review-summary__title {
  margin: 0;
  color: var(--ink);
  font: 700 clamp(22px, 3vw, 30px)/1.4 var(--font-mincho);
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.paper-review-summary__status {
  margin: 0;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.paper-review-summary__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.paper-review-summary__link {
  display: inline-grid;
  min-block-size: 44px;
  place-items: center;
  padding: 0 20px;
  border: 1px solid var(--rule);
  color: var(--ink);
  font-size: 14px;
  line-height: 1;
  text-decoration: none;
}

.paper-review-summary__link--primary {
  border-color: var(--vermilion);
  color: var(--vermilion);
  font-weight: 600;
}

.paper-review-summary__link:hover:not(.paper-review-summary__link--primary) {
  border-color: var(--vermilion);
  color: var(--vermilion);
}

.paper-review-summary__link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.paper-review-summary__secondary {
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 12px;
}

.paper-review-summary__secondary summary {
  color: var(--ink);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.paper-review-summary__secondary summary:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-review-summary__secondary-body {
  display: grid;
  gap: 12px;
  padding-block-start: 12px;
}

.paper-review-summary__note {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.paper-review-summary__gaps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-review-summary__gap {
  padding-block-start: 6px;
  border-block-start: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.paper-review-summary__artifact {
  color: var(--ink);
  font-weight: 600;
}
</style>