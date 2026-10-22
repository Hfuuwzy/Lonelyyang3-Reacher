<template>
  <section
    v-if="gaps.length > 0"
    id="dossier-gaps"
    class="reader-dossier__gaps"
    data-testid="dossier-gaps"
    aria-labelledby="dossier-gaps-title"
  >
    <h3 id="dossier-gaps-title" class="reader-dossier__section-title">未覆盖范围</h3>
    <ul class="reader-dossier__gaps-list">
      <li
        v-for="(entry, index) in gapEntries"
        :key="`${entry.gap.artifact}-${entry.gap.code}-${entry.gap.unitIds.join(',')}-${index}`"
        class="reader-dossier__gap"
      >
        <span class="reader-dossier__gap-artifact">{{ readerGapArtifactLabel(entry.gap.artifact) }}</span>
        <span class="reader-dossier__gap-code">{{ entry.gap.code }}</span>
        <span v-if="entry.headingText !== ''" class="reader-dossier__gap-headings">{{ entry.headingText }}</span>
        <span class="reader-dossier__gap-range">{{ readerGapRangeLabel(entry.gap) }}</span>
        <template v-if="entry.gap.unitIds.length > 0">
          <span class="reader-dossier__gap-units">（{{ entry.gap.unitIds.join('、') }}）</span>
        </template>
        <span class="reader-dossier__gap-reason">：{{ entry.gap.reason }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { PaperReviewTaskGap, PaperSourceUnit } from '~/utils/paper-review-task-contract'
import { readerGapArtifactLabel, readerGapHeadings, readerGapRangeLabel } from './reader-dossier-labels'

interface Props {
  readonly gaps: readonly PaperReviewTaskGap[]
  readonly units: readonly PaperSourceUnit[]
}

interface GapEntry {
  readonly gap: PaperReviewTaskGap
  /** Unique app-owned section headings of the gap's unit ids, joined. */
  readonly headingText: string
}

const props = defineProps<Props>()

const gapEntries = computed<readonly GapEntry[]>(() =>
  props.gaps.map((gap) => ({
    gap,
    headingText: readerGapHeadings(gap, props.units).join('、'),
  })),
)
</script>

<style scoped>
.reader-dossier__section-title {
  margin: 0;
  color: var(--ink);
  font: 700 20px/1.4 var(--font-mincho);
}

/* —— 未覆盖范围 —— */
.reader-dossier__gaps {
  display: grid;
  gap: 12px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier__gaps-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reader-dossier__gap {
  padding-block-start: 8px;
  border-block-start: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.reader-dossier__gap-artifact {
  color: var(--ink);
  font-weight: 600;
}

.reader-dossier__gap-code {
  margin-inline-start: 8px;
  color: var(--vermilion);
  font-variant-numeric: tabular-nums;
}

.reader-dossier__gap-headings {
  margin-inline-start: 8px;
  color: var(--ink);
  font-weight: 600;
}

.reader-dossier__gap-range {
  margin-inline-start: 8px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.reader-dossier__gap-reason {
  color: var(--ink-soft);
}
</style>
