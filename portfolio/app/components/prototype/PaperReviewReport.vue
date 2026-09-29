<template>
  <section
    data-testid="paper-review-report"
    class="paper-review-report"
    aria-labelledby="paper-review-report-title"
  >
    <header class="paper-review-report__masthead">
      <span class="paper-review-report__stamp">未完成</span>
      <div class="paper-review-report__masthead-copy">
        <p class="paper-review-report__english">REVIEW REPORT · 审阅报告</p>
        <h3 id="paper-review-report-title" class="paper-review-report__title">论文审阅结果</h3>
        <p class="paper-review-report__meta">提供方 {{ report.provider }} · 模型 {{ report.model }}</p>
      </div>
    </header>

    <p
      v-if="report.missingScope.includes('full-translation')"
      class="paper-review-report__incomplete"
    >
      本报告为不完整草稿：仅收录当前可核实的内容与出处定位；完整双语全文翻译（full-translation）尚未纳入本次审阅范围。
    </p>

    <section v-if="report.gaps.length > 0" class="paper-review-gaps" aria-labelledby="paper-review-gaps-title">
      <h4 id="paper-review-gaps-title" class="paper-review-gaps__title">未覆盖项</h4>
      <ul class="paper-review-gaps__list">
        <li v-for="gap in report.gaps" :key="`${gap.section}-${gap.reason}`" class="paper-review-gaps__item">
          <strong>{{ gap.section }}</strong>
          <span>：{{ gap.reason }}</span>
        </li>
      </ul>
    </section>

    <div v-for="section in report.sections" :key="`${section.kind}-${section.title}`" class="paper-review-section">
      <header class="paper-review-section__heading">
        <span class="paper-review-section__stamp">{{ paperReviewSectionKindLabel(section.kind) }}</span>
        <h4 class="paper-review-section__title">{{ section.title }}</h4>
      </header>

      <ul class="paper-review-section__findings">
        <li v-for="(finding, index) in section.findings" :key="index" class="paper-review-finding">
          <p class="paper-review-finding__statement">{{ finding.statement }}</p>
          <p class="paper-review-finding__source">
            出处：{{ finding.source.heading }} · 阅读页 {{ finding.source.readerPage }}
            <template v-if="finding.source.printedPage"> · 印刷页 {{ finding.source.printedPage }}</template>
          </p>
          <blockquote class="paper-review-finding__quote">{{ finding.source.quote }}</blockquote>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PaperReviewReport } from '~/utils/paper-review-contract'
import { paperReviewSectionKindLabel } from './paper-review-labels'

interface Props {
  readonly report: PaperReviewReport
}

defineProps<Props>()
</script>

<style scoped>
.paper-review-report {
  display: grid;
  gap: 28px;
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

.paper-review-gaps {
  display: grid;
  gap: 12px;
}

.paper-review-gaps__title {
  margin: 0;
  color: var(--ink);
  font: 600 18px/1.4 var(--font-mincho);
}

.paper-review-gaps__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-review-gaps__item {
  margin: 0;
  padding-block-start: 8px;
  border-block-start: 1px dotted var(--rule);
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
}

.paper-review-gaps__item strong {
  color: var(--ink);
  font-weight: 600;
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
  font: 600 20px/1.4 var(--font-mincho);
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
  font-size: 16px;
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

@media (width < 768px) {
  .paper-review-report__masthead {
    gap: 16px;
  }
}
</style>
