import type { PaperReviewGap } from '~/utils/paper-review-contract'
import type {
  PaperReviewTaskGap,
  PaperReviewTaskResult,
  PaperSourceReview,
  PaperSourceSpan,
  PaperSourceUnit,
} from '~/utils/paper-review-task-contract'
import { paperReviewGapItems } from './paper-review-labels'

/**
 * Display labels and range/gap/exclusion formatting for the paper-review
 * dossier rendered in the Reader B shell (issue #29). Pure and browser-safe:
 * no DOM, no fetch, no Node APIs — every function is unit-testable in the node
 * vitest environment.
 *
 * Per-unit view shaping and chapter TOC links live in reader-dossier-views.
 *
 * All strings come from the app's own contract data (unit kind/reason codes,
 * span coordinates) or fixed UI copy — model-provided prose is never rewritten
 * here, only placed beside its own label.
 */

export function readerTaskStatusLabel(status: PaperReviewTaskResult['status']): string {
  return status === 'complete' ? '完成' : '不完整'
}

export function readerUnitKindLabel(kind: PaperSourceUnit['kind']): string {
  switch (kind) {
    case 'paragraph':
      return '段落'
    case 'heading':
      return '标题'
    case 'caption':
      return '图注'
    case 'excluded':
      return '排除'
    case 'preserved-original':
      return '原文保留'
    case 'unresolved':
      return '未解析'
  }
}

export function readerExclusionReasonLabel(reason: 'bibliography' | 'appendix'): string {
  return reason === 'bibliography' ? '参考文献' : '附录'
}

export function readerPreservedReasonLabel(reason: 'formula' | 'table-content' | 'page-number'): string {
  switch (reason) {
    case 'formula':
      return '公式'
    case 'table-content':
      return '表格内容'
    case 'page-number':
      return '页码'
  }
}

export function readerReviewStatusLabel(status: PaperSourceReview['status']): string {
  switch (status) {
    case 'not-run':
      return '未核验'
    case 'incomplete':
      return '核验不完整'
    case 'passed':
      return '核验通过'
  }
}

export function readerReviewVerdictLabel(verdict: 'passed' | 'issues'): string {
  return verdict === 'passed' ? '通过' : '存在问题'
}

export function readerGapArtifactLabel(artifact: PaperReviewTaskGap['artifact']): string {
  switch (artifact) {
    case 'source':
      return '来源'
    case 'report':
      return '报告'
    case 'translation':
      return '译文'
    case 'source-review':
      return '核验'
  }
}

/**
 * Report-incomplete notice copy: names report section/reason gaps only, grouped
 * by identical reason. Returns null when the report has no gaps, so a failed
 * translation or source-review task never labels a gap-free report incomplete.
 */
export function readerReportIncompleteLine(gaps: readonly PaperReviewGap[]): string | null {
  if (gaps.length === 0) {
    return null
  }
  const items = paperReviewGapItems(gaps).map((item) => `${item.scopes.join('、')}：${item.reason}`)
  return `本报告为不完整草稿：${items.join('；')}`
}

function pagesText(pages: readonly number[]): string {
  if (pages.length === 0) {
    return '无页码'
  }
  if (pages.length === 1) {
    return `阅读页 ${pages[0]}`
  }
  const consecutive = pages.every((page, index) => index === 0 || page === (pages[index - 1] ?? 0) + 1)
  if (consecutive) {
    return `阅读页 ${pages[0]}–${pages[pages.length - 1]}`
  }
  return `阅读页 ${pages.join('、')}`
}

/** Sorted unique reader pages of a span list, e.g. [1, 2]. */
export function readerSpanPages(spans: readonly PaperSourceSpan[]): readonly number[] {
  return [...new Set(spans.map((span) => span.readerPage))].sort((a, b) => a - b)
}

/**
 * Localized range of an app-owned unit from its own spans, e.g.
 * `阅读页 1–2 · 第 2 行`. Page ranges use the min–max form when the pages are
 * consecutive, otherwise an enumerated form; line offsets are 1-based and shown
 * only when the unit stays within a single reader page.
 */
export function readerSpanRangeLabel(spans: readonly PaperSourceSpan[]): string {
  const first = spans[0]
  if (first === undefined) {
    return '范围未知'
  }
  const pageText = pagesText(readerSpanPages(spans))
  if (!spans.every((span) => span.readerPage === first.readerPage)) {
    return pageText
  }
  const lineIndexes = spans.map((span) => span.lineIndex)
  const lineStart = Math.min(...lineIndexes) + 1
  const lineEnd = Math.max(...lineIndexes) + 1
  const lineText = lineStart === lineEnd ? `第 ${lineStart} 行` : `第 ${lineStart}–${lineEnd} 行`
  return `${pageText} · ${lineText}`
}

/** Localized affected pages of a task gap; falls back to its spans. */
export function readerGapRangeLabel(gap: PaperReviewTaskGap): string {
  const pages = [...gap.readerPages].sort((a, b) => a - b)
  if (pages.length > 0) {
    return pagesText(pages)
  }
  return readerSpanRangeLabel(gap.spans)
}

/**
 * Unique nonblank app-owned section headings resolved from a gap's unit ids,
 * in the gap's unit-id order. Unknown or blank headings are skipped so a
 * source-less gap simply yields an empty list; headings are never inferred
 * from model text.
 */
export function readerGapHeadings(
  gap: PaperReviewTaskGap,
  units: readonly PaperSourceUnit[],
): readonly string[] {
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const))
  const headings: string[] = []
  const seen = new Set<string>()
  for (const unitId of gap.unitIds) {
    const heading = unitById.get(unitId)?.heading.trim()
    if (heading === undefined || heading === '' || seen.has(heading)) {
      continue
    }
    seen.add(heading)
    headings.push(heading)
  }
  return headings
}

/** Unique excluded-scope labels in first-seen order; empty string when none. */
export function readerExclusionScopeText(units: readonly PaperSourceUnit[]): string {
  const names: string[] = []
  for (const unit of units) {
    if (unit.kind !== 'excluded') {
      continue
    }
    const name = readerExclusionReasonLabel(unit.reason)
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  if (names.length === 0) {
    return ''
  }
  return `已排除范围：${names.join('、')}；排除单元不提供译文，保留原文。`
}
