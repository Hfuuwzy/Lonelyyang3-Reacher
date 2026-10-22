/**
 * Internal report evidence-notes helpers for the paper-review pipeline (issue
 * #29/#27).
 *
 * Lives outside `server/utils` so Nuxt's auto-import scanner never treats it as
 * a composable. A report batch is a *partial* analysis of one bounded source
 * chunk: it may support only some of the five section kinds and must not invent
 * an empty section. Each finding is verified against the global (whole-document)
 * scoped source + global structural headings — never just the chunk — so
 * inherited section headings resolve correctly. Accepted findings are then
 * aggregated into the five final sections; five-kind coverage is enforced only
 * on the final report, not per chunk. Bibliography/reference quotes are
 * excluded at the source scope and therefore fail verbatim verification here.
 */

import { z } from 'zod'
import {
  PAPER_REVIEW_MISSING_SCOPE,
  PAPER_REVIEW_SECTION_KINDS,
  type PaperReviewFinding,
  type PaperReviewGap,
  type PaperReviewReport,
  type PaperReviewSection,
  type PaperReviewSectionKind,
} from '../../app/utils/paper-review-contract'
import type { ExtractedPaperPage } from '../utils/paper-review/pdf'
import type { StructuralHeading } from '../utils/paper-review/source-matching'
import { verifyPaperReviewSource } from './report-source-verifier'
import { parseModelJson } from '../utils/paper-review/model-json'

const sourceSchema = z.object({
  heading: z.string(),
  readerPage: z.number(),
  printedPage: z.string().optional(),
  quote: z.string(),
})
const findingSchema = z.object({ statement: z.string(), source: sourceSchema })
const sectionSchema = z.object({
  kind: z.enum(PAPER_REVIEW_SECTION_KINDS),
  title: z.string(),
  findings: z.array(findingSchema).default([]),
})
const gapSchema = z.object({
  section: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
})
const notesSchema = z.object({ sections: z.array(sectionSchema), gaps: z.array(gapSchema).default([]) })

export interface ReportEvidenceContext {
  readonly pages: readonly ExtractedPaperPage[]
  readonly pageCount: number
  readonly headings: readonly StructuralHeading[]
}

export type KindCounts = Record<PaperReviewSectionKind, number>

export interface EvidenceNotes {
  readonly gaps: readonly PaperReviewGap[]
  readonly findingsByKind: ReadonlyMap<PaperReviewSectionKind, PaperReviewFinding[]>
  readonly titles: ReadonlyMap<PaperReviewSectionKind, string>
  readonly droppedByKind: KindCounts
  readonly unlocatedByKind: KindCounts
}

export type EvidenceNotesResult =
  | { readonly kind: 'ok'; readonly notes: EvidenceNotes }
  | { readonly kind: 'unusable' }

export function kindCounts(): KindCounts {
  return { claims: 0, methods: 0, experiments: 0, evidence: 0, criticism: 0 }
}

/**
 * Parse one chunk's raw model response as partial evidence notes and verify each
 * finding against the global context. Findings with an ungrounded citation are
 * dropped and counted; empty headings on a grounded quote count as unlocated.
 */
export function parseEvidenceNotes(raw: string, context: ReportEvidenceContext): EvidenceNotesResult {
  const parsed = notesSchema.safeParse(parseModelJson(raw))
  if (!parsed.success) {
    return { kind: 'unusable' }
  }
  const findingsByKind = new Map<PaperReviewSectionKind, PaperReviewFinding[]>()
  const titles = new Map<PaperReviewSectionKind, string>()
  const droppedByKind = kindCounts()
  const unlocatedByKind = kindCounts()
  for (const section of parsed.data.sections) {
    const accepted: PaperReviewFinding[] = []
    for (const rawFinding of section.findings) {
      const verified = verifyPaperReviewSource(rawFinding.source, context)
      if (!verified.grounded) {
        droppedByKind[section.kind] += 1
        continue
      }
      if (verified.headingUnlocated) {
        unlocatedByKind[section.kind] += 1
      }
      accepted.push({
        statement: rawFinding.statement,
        source: {
          heading: rawFinding.source.heading,
          readerPage: rawFinding.source.readerPage,
          printedPage: verified.printedPage,
          quote: rawFinding.source.quote,
        },
      })
    }
    if (accepted.length > 0) {
      findingsByKind.set(section.kind, [...(findingsByKind.get(section.kind) ?? []), ...accepted])
      if (section.title.trim() !== '' && !titles.has(section.kind)) {
        titles.set(section.kind, section.title.trim())
      }
    }
  }
  return { kind: 'ok', notes: { findingsByKind, titles, droppedByKind, unlocatedByKind, gaps: parsed.data.gaps } }
}

const SECTION_LABELS: Record<PaperReviewSectionKind, string> = {
  claims: 'Claims',
  methods: 'Methods',
  experiments: 'Experiments',
  evidence: 'Evidence',
  criticism: 'Criticism',
}

const GAP_NO_SECTION = '该章节没有跨文档聚合出任何可核验的论断，本次未覆盖。'
const GAP_CITATION = '该章节存在未通过原文出处核验的论断，未核验内容已剔除。'
const GAP_UNLOCATED = '该章节存在引文已核验但未标注所属章节标题的论断，该论断仍被保留。'

export interface ReportSynthesisInput {
  readonly generationGaps?: readonly PaperReviewGap[]
  readonly provider: string
  readonly model: string
  readonly findingsByKind: ReadonlyMap<PaperReviewSectionKind, PaperReviewFinding[]>
  readonly titles: ReadonlyMap<PaperReviewSectionKind, string>
  readonly droppedByKind: KindCounts
  readonly unlocatedByKind: KindCounts
  readonly emptyReaderPages: readonly number[]
  readonly partialBatches: number
}

/**
 * Aggregate accepted evidence notes into the five final report sections,
 * enforcing five-kind coverage only here. A kind with no grounded findings
 * anywhere becomes a gap; dropped citations, unlocated headings, empty reader
 * pages, and failed/oversized report batches each surface as gaps. No universal
 * five-kind requirement is applied per chunk.
 */
export function synthesizeReport(input: ReportSynthesisInput): PaperReviewReport {
  const sections: PaperReviewSection[] = []
  const gaps: PaperReviewGap[] = [...(input.generationGaps ?? [])]
  for (const kind of PAPER_REVIEW_SECTION_KINDS) {
    const findings = input.findingsByKind.get(kind) ?? []
    if (findings.length === 0) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_NO_SECTION })
      continue
    }
    sections.push({ kind, title: input.titles.get(kind) ?? SECTION_LABELS[kind], findings })
    if ((input.droppedByKind[kind] ?? 0) > 0) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_CITATION })
    } else if ((input.unlocatedByKind[kind] ?? 0) > 0) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_UNLOCATED })
    }
  }
  if (input.emptyReaderPages.length > 0) {
    gaps.push({ section: 'PDF source', reason: `PDF 阅读页 ${input.emptyReaderPages.join(', ')} 没有可选择文本，本次未进行 OCR。` })
  }
  if (input.partialBatches > 0) {
    gaps.push({ section: 'overall', reason: '部分分析批次未生成或未通过核验，本次报告不完整。' })
  }
  return {
    status: 'incomplete',
    provider: input.provider,
    model: input.model,
    sections,
    gaps,
    missingScope: PAPER_REVIEW_MISSING_SCOPE,
  }
}
