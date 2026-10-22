<template>
  <section
    id="dossier-review"
    class="reader-dossier__review"
    data-testid="dossier-review"
    aria-labelledby="dossier-review-title"
  >
    <h3 id="dossier-review-title" class="reader-dossier__section-title">核验状态</h3>
    <p class="reader-dossier__review-status" :data-status="review.status" role="status">
      {{ reviewStatusLine }}
    </p>
    <p class="reader-dossier__review-note">
      模型对照复检：检查遗漏、术语、数字、否定关系；通过不等于人工审校（核验范围：{{ review.reviewOf }}）。
    </p>
    <ul v-if="review.checks.length > 0" class="reader-dossier__review-checks">
      <li
        v-for="check in review.checks"
        :key="check.unitId"
        class="reader-dossier__review-check"
        :data-verdict="check.verdict"
      >
        <span class="reader-dossier__review-unit">{{ check.unitId }}</span>
        <span>{{ readerReviewVerdictLabel(check.verdict) }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { PaperSourceReview } from '~/utils/paper-review-task-contract'
import { readerReviewStatusLabel, readerReviewVerdictLabel } from './reader-dossier-labels'

interface Props {
  readonly review: PaperSourceReview
}

const props = defineProps<Props>()

const reviewStatusLine = computed(() => `核验状态：${readerReviewStatusLabel(props.review.status)}`)
</script>

<style scoped>
.reader-dossier__section-title {
  margin: 0;
  color: var(--ink);
  font: 700 20px/1.4 var(--font-mincho);
}

/* —— 核验状态 —— */
.reader-dossier__review {
  display: grid;
  gap: 10px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier__review-status {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.7;
}

.reader-dossier__review-status[data-status='passed'] {
  color: var(--ink);
}

.reader-dossier__review-status[data-status='incomplete'],
.reader-dossier__review-status[data-status='not-run'] {
  color: var(--vermilion);
}

.reader-dossier__review-note {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.reader-dossier__review-checks {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reader-dossier__review-check {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-block-start: 8px;
  border-block-start: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.reader-dossier__review-check[data-verdict='issues'] {
  color: var(--vermilion);
}

.reader-dossier__review-unit {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
</style>
