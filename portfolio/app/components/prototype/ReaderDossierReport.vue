<template>
  <section
    v-if="dossier.report"
    id="dossier-report"
    class="paper-review-report"
    data-testid="paper-review-report"
    aria-labelledby="paper-review-report-title"
  >
    <header class="paper-review-report__masthead">
      <span class="paper-review-report__stamp">报告</span>
      <div class="paper-review-report__masthead-copy">
        <p class="paper-review-report__english">REVIEW REPORT · 审阅报告</p>
        <h3 id="paper-review-report-title" class="paper-review-report__title">深读报告</h3>
        <p class="paper-review-report__meta">提供方 {{ dossier.provider }} · 模型 {{ dossier.model }}</p>
      </div>
    </header>

    <p v-if="reportIncompleteLine !== null" class="paper-review-report__incomplete">
      {{ reportIncompleteLine }}
    </p>

    <p
      v-if="dossier.report.sections.length > 0"
      class="paper-review-report__verification-note"
    >
      核验说明：本报告仅核验引文与 PDF 原文在标注阅读页上的逐字一致性；出处匹配不代表论断在原文中获得语义支持，亦不代表结论成立或全文内容已覆盖。
    </p>

    <div
      v-for="section in dossier.report.sections"
      :key="`${section.kind}-${section.title}`"
      class="paper-review-section"
    >
      <header class="paper-review-section__heading">
        <span class="paper-review-section__stamp">{{ paperReviewSectionKindLabel(section.kind) }}</span>
        <h4 class="paper-review-section__title">{{ section.title }}</h4>
      </header>

      <ul class="paper-review-section__findings">
        <li v-for="(finding, index) in section.findings" :key="index" class="paper-review-finding">
          <p class="paper-review-finding__statement">{{ finding.statement }}</p>
          <p class="paper-review-finding__source">
            出处：{{ paperReviewHeadingLabel(finding.source.heading) }} · 阅读页 {{ finding.source.readerPage }}
            <template v-if="finding.source.printedPage"> · 印刷页 {{ finding.source.printedPage }}</template>
          </p>
          <blockquote class="paper-review-finding__quote">{{ finding.source.quote }}</blockquote>
        </li>
      </ul>
    </div>
  </section>
  <section
    v-else
    id="dossier-report"
    class="reader-dossier__no-report"
    data-testid="dossier-no-report"
    aria-labelledby="dossier-no-report-title"
  >
    <h3 id="dossier-no-report-title" class="reader-dossier__section-title">深读报告</h3>
    <p class="reader-dossier__no-report-copy">本次任务未生成深读报告。</p>
  </section>
</template>

<script setup lang="ts">
import type { PaperReviewTaskResult } from '~/utils/paper-review-task-contract'
import { paperReviewHeadingLabel, paperReviewSectionKindLabel } from './paper-review-labels'
import { readerReportIncompleteLine } from './reader-dossier-labels'

interface Props {
  readonly dossier: PaperReviewTaskResult
}

const props = defineProps<Props>()

/** Report-incomplete notice: report gaps only, never task-gap or review status. */
const reportIncompleteLine = computed(() => readerReportIncompleteLine(props.dossier.report?.gaps ?? []))
</script>

<style scoped>
.reader-dossier__section-title {
  margin: 0;
  color: var(--ink);
  font: 700 20px/1.4 var(--font-mincho);
}

/* —— 报告（沿用 #27 报告结构） —— */
.paper-review-report {
  display: grid;
  gap: 28px;
  padding: 0;
  border: 0;
  background: transparent;
}

.paper-review-report__masthead {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}

.paper-review-report__stamp {
  display: inline-grid;
  flex: none;
  min-inline-size: 44px;
  min-block-size: 44px;
  place-items: center;
  border: 2px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
  writing-mode: vertical-rl;
}

.paper-review-report__masthead-copy {
  display: grid;
  gap: 8px;
}

.paper-review-report__english {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

.paper-review-report__title {
  margin: 0;
  color: var(--ink);
  font: 600 clamp(22px, 3vw, 32px)/1.4 var(--font-mincho);
}

.paper-review-report__meta {
  margin: 0;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.paper-review-report__incomplete {
  margin: 0;
  padding: 16px 20px;
  border: 2px solid var(--vermilion);
  background-color: color-mix(in srgb, var(--sakura) 20%, var(--paper-warm));
  color: var(--ink);
  font-size: 15px;
  line-height: 1.8;
}

.paper-review-report__verification-note {
  margin: 0;
  padding: 12px 16px;
  border-block-start: 1px dotted var(--rule);
  border-block-end: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.paper-review-section {
  display: grid;
  gap: 16px;
  padding-block-start: 24px;
  border-block-start: 1px dotted var(--rule);
}

.paper-review-section__heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.paper-review-section__stamp {
  display: inline-grid;
  flex: none;
  min-inline-size: 40px;
  min-block-size: 40px;
  place-items: center;
  border: 2px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
  writing-mode: vertical-rl;
}

.paper-review-section__title {
  margin: 0;
  color: var(--ink);
  font: 700 20px/1.4 var(--font-mincho);
}

.paper-review-section__findings {
  display: grid;
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-review-finding {
  display: grid;
  gap: 8px;
}

.paper-review-finding__statement {
  margin: 0;
  color: var(--ink);
  font-size: 17px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.paper-review-finding__source {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.paper-review-finding__quote {
  margin: 0;
  padding-inline-start: 16px;
  border-inline-start: 2px solid var(--rule);
  color: var(--ink);
  font-family: var(--font-mincho);
  font-size: 15px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reader-dossier__no-report {
  display: grid;
  gap: 10px;
  padding-block-start: 28px;
  border-block-start: 1px dotted var(--rule);
}

.reader-dossier__no-report-copy {
  margin: 0;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.8;
}

@media (width < 768px) {
  .paper-review-report__masthead {
    gap: 16px;
  }
}
</style>
