/**
 * Human-readable shaping of the paper-review task gaps and translation review
 * for the reader pages and the workbench summary.
 *
 * Browser-safe pure functions (no DOM, no fetch, no Node APIs) that turn the
 * wire-level gap codes / unit ids / fingerprints into readable Chinese lines:
 * known codes map to concrete Chinese actions, affected pages aggregate into
 * contiguous ranges, distinct section headings stay preserved, and unit ids /
 * codes / fingerprints only surface in the separately labeled technical
 * details. The code -> Chinese action table lives in
 * `paper-review-gaps-codes.ts` and is re-exported here.
 */

import type {
  PaperReviewTaskGap,
  PaperReviewTaskResult,
  PaperSourceReview,
  PaperSourceUnit,
} from '~/utils/paper-review-task-contract'
import {
  resolvePaperReviewArtifactLabel as paperReviewArtifactLabel,
  resolvePaperReviewGapCodeAction as paperReviewGapCodeAction,
} from './paper-review-gaps-codes'

export { resolvePaperReviewArtifactLabel as paperReviewArtifactLabel, resolvePaperReviewGapCodeAction as paperReviewGapCodeAction } from './paper-review-gaps-codes'

/**
 * Human page-range text: contiguous runs collapse to a dash, gaps to commas,
 * e.g. `第 1 页`, `第 1–3 页`, `第 1、4 页`; empty for no pages.
 */
export function paperReviewPageRangeText(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  if (sorted.length === 0) {
    return ''
  }
  if (sorted.length === 1) {
    return `第 ${sorted[0]} 页`
  }
  const runs: string[] = []
  let start = sorted[0] as number
  let previous = start
  for (let i = 1; i <= sorted.length; i += 1) {
    const page = sorted[i]
    if (page !== undefined && page === previous + 1) {
      previous = page
      continue
    }
    runs.push(start === previous ? `${start}` : `${start}–${previous}`)
    if (page !== undefined) {
      start = page
      previous = page
    }
  }
  return `第 ${runs.join('、')} 页`
}

/** Distinct nonblank app-owned section headings of the affected unit ids, in order. */
export function paperReviewGapHeadings(gap: PaperReviewTaskGap, units: readonly PaperSourceUnit[]): readonly string[] {
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

/** One aggregated human line per (artifact, code) group, first-seen order. */
export interface PaperReviewHumanGapGroup {
  readonly artifact: PaperReviewTaskGap['artifact']
  readonly artifactLabel: string
  readonly code: string
  readonly action: string
  readonly pageText: string
  readonly headings: readonly string[]
  readonly unitCount: number
}

/**
 * Aggregates task gaps into human lines: same artifact+code gaps merge, their
 * pages collapse into contiguous ranges, distinct section headings and the
 * unique affected unit count are preserved — raw unit ids and codes never
 * appear here.
 */
export function paperReviewHumanGapGroups(
  gaps: readonly PaperReviewTaskGap[],
  units: readonly PaperSourceUnit[],
): readonly PaperReviewHumanGapGroup[] {
  const groups = new Map<string, PaperReviewHumanGapGroup>()
  const pagesByKey = new Map<string, number[]>()
  const unitIdsByKey = new Map<string, Set<string>>()
  const order: string[] = []
  for (const gap of gaps) {
    const key = `${gap.artifact}\u0000${gap.code}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        artifact: gap.artifact,
        artifactLabel: paperReviewArtifactLabel(gap.artifact),
        code: gap.code,
        action: paperReviewGapCodeAction(gap.code, gap.artifact),
        pageText: '',
        headings: [],
        unitCount: 0,
      }
      groups.set(key, group)
      order.push(key)
      pagesByKey.set(key, [])
      unitIdsByKey.set(key, new Set<string>())
    }
    pagesByKey.get(key)?.push(...gap.readerPages, ...gap.spans.map((span) => span.readerPage))
    const pages = pagesByKey.get(key) ?? []
    const unitIds = unitIdsByKey.get(key) as Set<string>
    for (const unitId of gap.unitIds) {
      unitIds.add(unitId)
    }
    groups.set(key, {
      ...group,
      pageText: paperReviewPageRangeText(pages),
      headings: mergeHeadings(group.headings, paperReviewGapHeadings(gap, units)),
      unitCount: unitIds.size,
    })
  }
  return order.map((key) => groups.get(key) as PaperReviewHumanGapGroup)
}

function mergeHeadings(current: readonly string[], next: readonly string[]): readonly string[] {
  const seen = new Set(current)
  const merged = [...current]
  for (const heading of next) {
    if (!seen.has(heading)) {
      seen.add(heading)
      merged.push(heading)
    }
  }
  return merged
}

export interface PaperReviewReviewCounts {
  readonly total: number
  readonly passed: number
  readonly issues: number
}

/** Human counts of the per-unit verification checks. */
export function paperReviewReviewCounts(review: PaperSourceReview): PaperReviewReviewCounts {
  const passed = review.checks.filter((check) => check.verdict === 'passed').length
  return {
    total: review.checks.length,
    passed,
    issues: review.checks.length - passed,
  }
}

/** One-line human status: counts and verdict, never the raw fingerprint. */
export function paperReviewReviewStatusLine(review: PaperSourceReview): string {
  const counts = paperReviewReviewCounts(review)
  switch (review.status) {
    case 'passed':
      return `核验通过：${counts.total} / ${counts.total}`
    case 'not-run':
      return '未核验：本次未进行原文对照复检'
    case 'incomplete':
      return `核验不完整：${counts.passed} / ${counts.total} 通过，${counts.issues} 项存在问题`
  }
}

export function paperReviewVerdictLabel(verdict: 'passed' | 'issues'): string {
  return verdict === 'passed' ? '通过' : '存在问题'
}

/** Grouped verification results by (verdict, section heading, reader page). */
export interface PaperReviewCheckGroup {
  readonly verdict: 'passed' | 'issues'
  readonly verdictLabel: string
  readonly heading: string
  readonly page: number
  readonly unitCount: number
}

/**
 * Human check groups: each line names a verdict, the section heading, and the
 * reader page, with the unit count; raw unit ids stay in technical details.
 */
export function paperReviewReviewCheckGroups(
  review: PaperSourceReview,
  units: readonly PaperSourceUnit[],
): readonly PaperReviewCheckGroup[] {
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const))
  const groups = new Map<string, PaperReviewCheckGroup>()
  const order: string[] = []
  for (const check of review.checks) {
    const unit = unitById.get(check.unitId)
    const heading = unit?.heading.trim() ?? ''
    const page = unit?.spans[0]?.readerPage ?? 0
    const key = `${check.verdict}\u0000${heading}\u0000${page}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        verdict: check.verdict,
        verdictLabel: paperReviewVerdictLabel(check.verdict),
        heading: heading === '' ? '未归类段落' : heading,
        page,
        unitCount: 0,
      }
      groups.set(key, group)
      order.push(key)
    }
    groups.set(key, { ...group, unitCount: group.unitCount + 1 })
  }
  return order.map((key) => groups.get(key) as PaperReviewCheckGroup)
}

/** Raw diagnostic view of one gap for the separately labeled technical details. */
export interface PaperReviewGapTechnical {
  readonly artifactLabel: string
  readonly code: string
  readonly unitIds: readonly string[]
  readonly pageText: string
  readonly reason: string
}

/** Raw diagnostic list for the technical details disclosure. */
export function paperReviewGapTechnicalList(gaps: readonly PaperReviewTaskGap[]): readonly PaperReviewGapTechnical[] {
  return gaps.map((gap) => ({
    artifactLabel: paperReviewArtifactLabel(gap.artifact),
    code: gap.code,
    unitIds: gap.unitIds,
    pageText: paperReviewPageRangeText(gap.readerPages),
    reason: gap.reason,
  }))
}

/** The review fingerprint the model checked against (technical details only). */
export function paperReviewReviewFingerprint(result: PaperReviewTaskResult): string {
  return result.translation.review.reviewOf
}
