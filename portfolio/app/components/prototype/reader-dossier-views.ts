import { isTranslationEligible } from '../../utils/paper-review-task-contract'
import type {
  PaperReviewTaskResult,
  PaperSourceUnit,
  PaperTranslationPair,
} from '~/utils/paper-review-task-contract'
import {
  readerExclusionReasonLabel,
  readerPreservedReasonLabel,
  readerSpanPages,
  readerSpanRangeLabel,
  readerUnitKindLabel,
} from './reader-dossier-labels'

/**
 * View shaping for the paper-review dossier rendered in the Reader B shell
 * (issue #29): per-unit display views, PDF page selection, and chapter TOC
 * links. Pure and browser-safe: no DOM, no fetch, no Node APIs — every
 * function is unit-testable in the node vitest environment.
 *
 * Shared label/range/gap/exclusion formatting lives in reader-dossier-labels;
 * this module composes it into display views and link lists.
 */

export interface ReaderDossierUnitView {
  readonly unit: PaperSourceUnit
  readonly kindLabel: string
  /** App-owned section heading; null when blank. */
  readonly headingLabel: string | null
  /** Exclusion/preserved/unresolved detail; null for translated kinds. */
  readonly detailLabel: string | null
  readonly rangeLabel: string
  readonly chinese: string | null
  /** True when an eligible unit has no pair or an explicit null translation. */
  readonly pairMissing: boolean
  /** Pages to link in the original PDF: app-owned unit span pages. */
  readonly pdfPages: readonly number[]
  /**
   * First original page to inline-preview, else null. At most one unit per
   * reader page receives a preview, in source order, so the same full PDF page
   * is never rendered twice on one dossier.
   */
  readonly previewPage: number | null
}

function unitDetailLabel(unit: PaperSourceUnit): string | null {
  switch (unit.kind) {
    case 'excluded':
      return readerExclusionReasonLabel(unit.reason)
    case 'preserved-original':
      return readerPreservedReasonLabel(unit.reason)
    case 'unresolved':
      return '未解析'
    default:
      return null
  }
}

/** Links and previews point at app-owned unit span pages for every kind. */
export function readerUnitPdfPages(unit: PaperSourceUnit): readonly number[] {
  return readerSpanPages(unit.spans)
}

/** Captions and preserved table/formula interiors preview inline; page-number units keep only a link. */
function isPreviewEligible(unit: PaperSourceUnit): boolean {
  return unit.kind === 'caption'
    || (unit.kind === 'preserved-original' && unit.reason !== 'page-number')
}

/**
 * Shapes every source unit for display in source order: translated kinds carry
 * their exact pair (`chinese` plus whether the pair is missing), captions and
 * preserved/excluded/unresolved units carry their app-owned span pages, and
 * preserved/excluded/unresolved units carry a marker detail instead of a
 * translation.
 */
export function readerDossierUnitViews(
  units: readonly PaperSourceUnit[],
  pairs: readonly PaperTranslationPair[],
): readonly ReaderDossierUnitView[] {
  const chineseByUnit = new Map(pairs.map((pair) => [pair.unitId, pair.chinese] as const))
  const pairUnitIds = new Set(pairs.map((pair) => pair.unitId))
  const views = units.map((unit) => {
    const chinese = chineseByUnit.get(unit.id) ?? null
    const heading = unit.heading.trim()
    return {
      unit,
      kindLabel: readerUnitKindLabel(unit.kind),
      headingLabel: heading === '' ? null : heading,
      detailLabel: unitDetailLabel(unit),
      rangeLabel: readerSpanRangeLabel(unit.spans),
      chinese,
      pairMissing: isTranslationEligible(unit) && (chinese === null || !pairUnitIds.has(unit.id)),
      pdfPages: readerUnitPdfPages(unit),
    }
  })
  const previewClaimed = new Set<number>()
  return views.map((view) => {
    let previewPage: number | null = null
    if (isPreviewEligible(view.unit) && view.pdfPages.length > 0) {
      const page = view.pdfPages[0]
      if (page !== undefined && !previewClaimed.has(page)) {
        previewClaimed.add(page)
        previewPage = page
      }
    }
    return { ...view, previewPage }
  })
}

export interface ReaderDossierTocLink {
  readonly id: string
  readonly text: string
}

/** B-style chapter navigation for a generated dossier, driven by app data. */
export function readerDossierTocLinks(result: PaperReviewTaskResult): readonly ReaderDossierTocLink[] {
  const links: ReaderDossierTocLink[] = [{ id: 'dossier-report', text: '审阅报告' }]
  if (result.gaps.length > 0) {
    links.push({ id: 'dossier-gaps', text: '未覆盖范围' })
  }
  links.push({ id: 'dossier-translation', text: '译文对照' })
  for (const unit of result.source.units) {
    if (unit.kind === 'heading') {
      links.push({ id: `dossier-unit-${unit.id}`, text: unit.original })
    }
  }
  links.push({ id: 'dossier-review', text: '核验状态' })
  return links
}