import { z } from 'zod'
import type { ExtractedPaperPage } from './pdf'
import { collectStructuralHeadings } from './source-matching'
import { verifyPaperReviewSource } from '../../paper-review-internal/report-source-verifier'
import {
  PAPER_REVIEW_MISSING_SCOPE,
  PAPER_REVIEW_SECTION_KINDS,
  type PaperReviewFinding,
  type PaperReviewGap,
  type PaperReviewReport,
  type PaperReviewSection,
  type PaperReviewSectionKind,
} from '../../../app/utils/paper-review-contract'

/**
 * Report parser and source-location verifier for the paper-review prototype
 * (issue #27).
 *
 * Accepts the untrusted raw Harness response plus the already-extracted PDF
 * pages, parses the model JSON with a Zod boundary, and verifies every finding's
 * heading and quoted text against the cited 1-based reader page. Invalid
 * citations and omitted sections become explicit gaps; the output is always
 * `status:'incomplete'` with `missingScope:['full-translation']` (full
 * translation is owned by issue #29). A malformed or unusable response returns
 * a typed failure, never a fabricated citation.
 */

export type PaperReviewReportErrorCode = 'malformed-json' | 'malformed-report'

export interface PaperReviewReportError {
  readonly code: PaperReviewReportErrorCode
  readonly message: string
}

export type PaperReviewReportResult =
  | { readonly success: true; readonly report: PaperReviewReport }
  | { readonly success: false; readonly error: PaperReviewReportError }

/** Boundary schema for the untrusted model JSON (parse, don't validate). */
const sourceSchema = z.object({
  heading: z.string(),
  readerPage: z.number(),
  printedPage: z.string().optional(),
  quote: z.string(),
})

const findingSchema = z.object({
  statement: z.string(),
  source: sourceSchema,
})

const sectionSchema = z.object({
  kind: z.enum(PAPER_REVIEW_SECTION_KINDS),
  title: z.string(),
  findings: z.array(findingSchema).default([]),
})

const gapSchema = z.object({
  section: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
})

const rawReportSchema = z.object({
  sections: z.array(sectionSchema),
  gaps: z.array(gapSchema).default([]),
})

/** Stable, machine-generated English labels used to name gaps for each kind. */
const SECTION_LABELS: Record<PaperReviewSectionKind, string> = {
  claims: 'Claims',
  methods: 'Methods',
  experiments: 'Experiments',
  evidence: 'Evidence',
  criticism: 'Criticism',
}

const GAP_REASON_NO_SECTION = '该章节内容未出现在模型输出中，本次未生成可核验内容。'
const GAP_REASON_NO_FINDINGS = '该章节没有提供任何论断，本次未覆盖。'
const GAP_REASON_CITATION =
  '该章节存在未通过原文出处核验的论断（页码、章节标题或引文与 PDF 原文不符），未核验内容已剔除。'
const GAP_REASON_PRINTED_PAGE = '该章节存在未能独立验证的印刷页标签，该印刷页信息已省略。'
const GAP_REASON_HEADING_UNLOCATED =
  '该章节存在未指明所属章节标题的论断（引文已核验但模型未标注所属章节标题），该论断仍被保留。'

/**
 * Parse the untrusted raw Harness response and verify every finding against the
 * extracted pages, building a source-grounded `PaperReviewReport`. Returns a
 * typed failure for malformed/unusable input.
 */
export function verifyPaperReview(
  raw: string,
  pages: readonly ExtractedPaperPage[],
  provider: string,
  model: string,
): PaperReviewReportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: {
          code: 'malformed-json',
          message: '模型返回的内容不是有效的 JSON，无法解析为审阅报告。',
        },
      }
    }
    throw error
  }

  const boundary = rawReportSchema.safeParse(parsed)
  if (!boundary.success) {
    return {
      success: false,
      error: {
        code: 'malformed-report',
        message: '模型返回的 JSON 结构不符合审阅报告协议，本次审阅结果不可用。',
      },
    }
  }

  const pageCount = Math.max(0, ...pages.map((page) => page.readerPage))
  const structuralHeadings = collectStructuralHeadings(pages)
  const rawSections = new Map<PaperReviewSectionKind, z.infer<typeof sectionSchema>>()
  for (const section of boundary.data.sections) {
    rawSections.set(section.kind, section)
  }

  const sections: PaperReviewSection[] = []
  const gaps: PaperReviewGap[] = boundary.data.gaps.map((gap) => ({
    section: gap.section,
    reason: gap.reason,
  }))
  const emptyReaderPages = pages
    .filter((page) => page.text.trim() === '')
    .map((page) => page.readerPage)
  if (emptyReaderPages.length > 0) {
    gaps.push({
      section: 'PDF source',
      reason: `PDF 阅读页 ${emptyReaderPages.join(', ')} 没有可选择文本，本次未进行 OCR。`,
    })
  }

  for (const kind of PAPER_REVIEW_SECTION_KINDS) {
    const rawSection = rawSections.get(kind)
    if (rawSection === undefined) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_REASON_NO_SECTION })
      continue
    }

    const findings: PaperReviewFinding[] = []
    let citationFailed = false
    let printedDropped = false
    let headingUnlocated = false

    for (const rawFinding of rawSection.findings) {
      const verified = verifyPaperReviewSource(rawFinding.source, {
        pages,
        pageCount,
        headings: structuralHeadings,
      })
      if (!verified.grounded) {
        citationFailed = true
        continue
      }
      if (verified.printedDropped) {
        printedDropped = true
      }
      if (verified.headingUnlocated) {
        headingUnlocated = true
      }
      findings.push({
        statement: rawFinding.statement,
        source: {
          heading: rawFinding.source.heading,
          readerPage: rawFinding.source.readerPage,
          printedPage: verified.printedPage,
          quote: rawFinding.source.quote,
        },
      })
    }

    if (findings.length === 0) {
      gaps.push({
        section: SECTION_LABELS[kind],
        reason: citationFailed ? GAP_REASON_CITATION : GAP_REASON_NO_FINDINGS,
      })
      continue
    }

    sections.push({
      kind,
      title: rawSection.title.trim() === '' ? SECTION_LABELS[kind] : rawSection.title,
      findings,
    })
    if (citationFailed) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_REASON_CITATION })
    }
    if (headingUnlocated) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_REASON_HEADING_UNLOCATED })
    }
    if (printedDropped) {
      gaps.push({ section: SECTION_LABELS[kind], reason: GAP_REASON_PRINTED_PAGE })
    }
  }

  const report: PaperReviewReport = {
    status: 'incomplete',
    provider,
    model,
    sections,
    gaps,
    missingScope: PAPER_REVIEW_MISSING_SCOPE,
  }
  return { success: true, report }
}
