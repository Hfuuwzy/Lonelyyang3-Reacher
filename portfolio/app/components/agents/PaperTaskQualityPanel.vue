<template>
  <section
    v-if="entries.length > 0 || notice"
    class="paper-task-quality"
    aria-label="成果质量摘要"
    data-testid="paper-task-quality-panel"
  >
    <header class="paper-task-quality__header">
      <div>
        <p class="paper-task-quality__eyebrow">成果核对</p>
        <h2>质量摘要</h2>
      </div>
      <span v-if="report.issueCount > 0" class="paper-task-quality__count">
        {{ report.issueCount }} 项需确认
      </span>
      <span v-else class="paper-task-quality__count">状态以分支标记为准</span>
    </header>

    <p v-if="notice" class="paper-task-quality__notice" data-testid="paper-task-quality-notice">
      {{ notice }}
    </p>

    <ul v-if="entries.length > 0" class="paper-task-quality__branches" aria-label="分支成果状态">
      <li v-for="(entry, index) in entries" :key="`${entry.branch}-${index}`">
        <strong>{{ entry.branchLabel }}</strong>
        <span v-if="entry.headingLabel && !entry.badge.includes(entry.headingLabel)">{{ entry.headingLabel }}</span>
        <span v-if="entry.designation === 'sample'">样例生成内容</span>
        <span v-if="entry.badge !== ''" class="paper-task-quality__badge">{{ entry.badge }}</span>
        <span
          v-if="entry.statusLabel && !entry.badge.includes(entry.statusLabel) && entry.statusLabel !== entry.headingLabel"
          class="paper-task-quality__badge"
        >{{ entry.statusLabel }}</span>
      </li>
    </ul>

    <aside
      v-if="criticalGroups.length > 0"
      class="paper-task-quality__critical"
      aria-label="关键核对事项"
      data-testid="paper-task-quality-critical"
    >
      <h3>需优先核对</h3>
      <section
        v-for="group in criticalGroups"
        :key="group.category"
        class="paper-task-quality__critical-group"
        :data-category="group.category"
      >
        <h4>{{ criticalHeading(group.category) }} <span>· {{ group.issues.length }} 项</span></h4>
        <ul>
          <li v-for="(issue, index) in group.excerpts" :key="`${issue.text}-${index}`">
            <span class="paper-task-quality__issue-branches">{{ issue.branchLabels.join('、') }}：</span>
            {{ issue.text }}
          </li>
        </ul>
        <p v-if="group.remainingCount > 0" class="paper-task-quality__more">
          另有 {{ group.remainingCount }} 项，展开全部质量事项查看全文。
        </p>
      </section>
    </aside>

    <p v-if="report.capabilityCount > 0" class="paper-task-quality__capability-summary">
      工具／格式能力限制：{{ report.capabilityCount }} 项，具体内容收纳在完整列表中。
    </p>
    <p v-if="report.unclassifiedCount > 0" class="paper-task-quality__unclassified-summary">
      未分类需确认事项：{{ report.unclassifiedCount }} 项；全文保留在下方列表中。
    </p>
    <p v-if="entries.length > 0 && report.issueCount === 0" class="paper-task-quality__empty">
      暂无单独列出的质量事项；这不表示内容完整或质量通过。
    </p>

    <details
      v-if="report.issueCount > 0 || report.handlingOptions.length > 0"
      class="paper-task-quality__details"
      data-testid="paper-task-quality-details"
    >
      <summary>
        {{ report.issueCount > 0 ? `查看全部 ${report.issueCount} 项质量事项` : '查看处理选择' }}
        <span v-if="report.handlingOptions.length > 0">与处理选择</span>
      </summary>
      <div class="paper-task-quality__details-content">
        <section
          v-for="group in report.groups"
          :key="group.category"
          class="paper-task-quality__group"
          :data-category="group.category"
        >
          <h3>{{ group.label }} <span>· {{ group.issues.length }} 项</span></h3>
          <ul>
            <li v-for="(issue, index) in group.issues" :key="`${issue.text}-${index}`">
              <span class="paper-task-quality__issue-branches">{{ issue.branchLabels.join('、') }}：</span>
              {{ issue.text }}
            </li>
          </ul>
        </section>

        <section v-if="report.handlingOptions.length > 0" class="paper-task-quality__group">
          <h3>处理选择</h3>
          <ul>
            <li v-for="(option, index) in report.handlingOptions" :key="`${option.label}-${index}`">
              <span class="paper-task-quality__issue-branches">{{ option.branchLabels.join('、') }}：</span>
              {{ option.label }}
            </li>
          </ul>
        </section>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  buildPaperTaskQualityReport,
  paperTaskQualityIssuePriority,
  type PaperTaskQualityEntry,
  type PaperTaskQualityIssueCategory,
} from '~/utils/paper-task-quality-summary'

const props = defineProps<{
  readonly entries: readonly PaperTaskQualityEntry[]
  readonly notice?: string | null
}>()

const report = computed(() => buildPaperTaskQualityReport(props.entries))
const criticalGroups = computed(() => report.value.groups
  .filter(group => group.category === 'table' || group.category === 'formula' || group.category === 'source')
  .map(group => {
    const prioritizedIssues = [...group.issues].sort((first, second) =>
      paperTaskQualityIssuePriority(second.text) - paperTaskQualityIssuePriority(first.text))
    const excerpts = prioritizedIssues.slice(0, 1)
    return {
      ...group,
      excerpts,
      remainingCount: group.issues.length - excerpts.length,
    }
  }))

function criticalHeading(category: PaperTaskQualityIssueCategory): string {
  switch (category) {
    case 'table': return '表格／数值需核对'
    case 'formula': return '公式需核对'
    case 'source': return '原文／图像需核对'
    case 'capability':
    case 'other':
      return '需确认事项'
    default: {
      const exhaustive: never = category
      return exhaustive
    }
  }
}
</script>

<style scoped>
.paper-task-quality {
  margin-block: 1.25rem;
  padding: clamp(1rem, 2.5vw, 1.4rem);
  border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--paper-warm) 76%, var(--paper));
  color: var(--ink);
  font-size: 1rem;
  line-height: 1.65;
}

.paper-task-quality__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.75rem;
}

.paper-task-quality__eyebrow {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.875rem;
  letter-spacing: 0.04em;
}

.paper-task-quality__header h2 {
  margin: 0.1rem 0 0;
  font-size: 1.25rem;
  line-height: 1.35;
}

.paper-task-quality__count,
.paper-task-quality__badge {
  display: inline-flex;
  align-items: center;
  min-block-size: 2rem;
  padding: 0.2rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper) 62%, var(--paper-warm));
  font-size: 0.9rem;
  line-height: 1.35;
}

.paper-task-quality__notice {
  margin: 0.75rem 0;
  overflow-wrap: anywhere;
}

.paper-task-quality__branches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.8rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.paper-task-quality__branches li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
  max-inline-size: 100%;
}

.paper-task-quality__branches li > span:not(.paper-task-quality__badge) {
  color: var(--ink-soft);
}

.paper-task-quality__critical {
  margin-block-start: 1rem;
  padding: 0.85rem 1rem;
  border-inline-start: 4px solid var(--vermilion, #a63828);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--vermilion, #a63828) 8%, var(--paper-warm));
}

.paper-task-quality__critical h3,
.paper-task-quality__group h3 {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.45;
}

.paper-task-quality__critical-group + .paper-task-quality__critical-group {
  margin-block-start: 0.7rem;
}

.paper-task-quality__critical-group h4 {
  margin: 0.5rem 0 0;
  font-size: 1rem;
}

.paper-task-quality__critical h3 span,
.paper-task-quality__critical-group h4 span,
.paper-task-quality__group h3 span {
  color: var(--ink-soft);
  font-weight: 500;
}

.paper-task-quality__critical ul,
.paper-task-quality__group ul {
  display: grid;
  gap: 0.45rem;
  margin: 0.45rem 0 0;
  padding-inline-start: 1.25rem;
}

.paper-task-quality__critical li,
.paper-task-quality__group li {
  overflow-wrap: anywhere;
}

.paper-task-quality__issue-branches {
  font-weight: 650;
}

.paper-task-quality__capability-summary,
.paper-task-quality__unclassified-summary,
.paper-task-quality__empty,
.paper-task-quality__more {
  margin: 0.75rem 0 0;
}

.paper-task-quality__details {
  margin-block-start: 0.85rem;
  border-block-start: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
}

.paper-task-quality__details summary {
  display: flex;
  align-items: center;
  min-block-size: 2.75rem;
  gap: 0.25rem;
  padding-block: 0.35rem;
  cursor: pointer;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.paper-task-quality__details summary:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--paper-task-accent, var(--vermilion)) 45%, transparent);
  outline-offset: 3px;
}

.paper-task-quality__details-content {
  display: grid;
  gap: 1rem;
  padding-block: 0.35rem 0.75rem;
}

.paper-task-quality__group + .paper-task-quality__group {
  padding-block-start: 0.75rem;
  border-block-start: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
}

@media (max-width: 640px) {
  .paper-task-quality__header {
    align-items: flex-start;
  }

  .paper-task-quality__count {
    flex: 0 0 auto;
  }
}
</style>
