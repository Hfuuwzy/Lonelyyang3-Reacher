/**
 * Secondary Markdown sections for the paper-review readers, built on the
 * primary projection (`paper-review-markdown.ts`) and the human gap/review
 * shaping (`paper-review-gaps.ts`).
 *
 * Browser-safe pure functions, unit-testable in the node vitest environment:
 *
 * - `buildPaperReviewReportSourcesMarkdown` — numbered `[n]` footnotes with the
 *   quoted sources behind the report's citation refs,
 * - `buildPaperReviewReviewMarkdown` — human review status: verdict counts and
 *   per-verdict section/page groups, never the raw fingerprint,
 * - `buildPaperReviewGapsMarkdown` — human gap groups: Chinese actions, page
 *   ranges, headings, and unit counts,
 * - `buildPaperReviewEnglishAppendixMarkdown` — every source unit in order:
 *   eligible units with the paired Chinese and span provenance, preserved /
 *   excluded / unresolved originals verbatim in inert fences with scope,
 *   warning, and page links,
 * - `buildPaperReviewTechnicalDetailsMarkdown` — the raw codes, unit ids,
 *   reasons, and the review fingerprint under a separately labeled disclosure,
 * - download composition and file names.
 */

import type { PaperReviewTaskResult } from './paper-review-task-contract'
import {
  buildPaperReviewReportMarkdown,
  buildPaperReviewTranslationMarkdown,
  paperReviewEscapeHeading,
  paperReviewEscapeMarkdown,
  paperReviewPdfPageLink,
  preservedCodeFence,
} from './paper-review-markdown'
import {
  paperReviewGapTechnicalList,
  paperReviewHumanGapGroups,
  paperReviewReviewCheckGroups,
  paperReviewReviewFingerprint,
  paperReviewReviewStatusLine,
} from './paper-review-gaps'
import { paperReviewHeadingLabel } from '../components/prototype/paper-review-labels'
import {
  readerExclusionReasonLabel,
  readerPreservedReasonLabel,
  readerSpanRangeLabel,
} from '../components/prototype/reader-dossier-labels'

/**
 * Numbered footnotes for the report's `[n]` citation refs: source heading,
 * reader page, optional printed page, PDF link, and the verbatim quote. Empty
 * string when the report is absent or has no findings.
 */
export function buildPaperReviewReportSourcesMarkdown(result: PaperReviewTaskResult): string {
  if (result.report === null) {
    return ''
  }
  const findings = result.report.sections.flatMap((section) => section.findings)
  if (findings.length === 0) {
    return ''
  }
  const parts: string[] = ['## 出处', '', '> 以下为正文 [n] 引文标记对应的原文出处与逐字引文。', '']
  let citation = 0
  for (const section of result.report.sections) {
    for (const finding of section.findings) {
      citation += 1
      const printed = finding.source.printedPage === undefined
        ? ''
        : ` · 印刷页 ${paperReviewEscapeMarkdown(finding.source.printedPage)}`
      parts.push(
        `[${citation}] 出处：${paperReviewEscapeMarkdown(paperReviewHeadingLabel(finding.source.heading))} · 阅读页 ${finding.source.readerPage}${printed} · ${paperReviewPdfPageLink(finding.source.readerPage)}`,
        '',
      )
      parts.push(`> ${paperReviewEscapeMarkdown(finding.source.quote)}`, '')
    }
  }
  return parts.join('\n').trim() + '\n'
}

/** Human review section: status line with verdict counts, then grouped
 * verdict/section/page lines; the fingerprint stays in technical details. */
export function buildPaperReviewReviewMarkdown(result: PaperReviewTaskResult): string {
  const review = result.translation.review
  const parts: string[] = [
    '## 核验状态',
    '',
    `> 核验状态：${paperReviewEscapeMarkdown(paperReviewReviewStatusLine(review))}`,
    '',
  ]
  for (const group of paperReviewReviewCheckGroups(review, result.source.units)) {
    const units = group.unitCount > 1 ? `（${group.unitCount} 个单元）` : ''
    const page = group.page > 0 ? ` · 第 ${group.page} 页` : ''
    parts.push(`- ${group.verdictLabel}：${paperReviewEscapeMarkdown(group.heading)}${page}${units}`)
  }
  parts.push(
    '',
    '> 模型对照复检：检查遗漏、术语、数字、否定关系；通过不等于人工审校。',
    '',
  )
  return parts.join('\n').trim() + '\n'
}

/** Human gap section: one aggregated line per (artifact, code) group with
 * Chinese actions, contiguous page ranges, headings, and unit counts. Empty
 * string when the task has no gaps. */
export function buildPaperReviewGapsMarkdown(result: PaperReviewTaskResult): string {
  const groups = paperReviewHumanGapGroups(result.gaps, result.source.units)
  if (groups.length === 0) {
    return ''
  }
  const parts: string[] = ['## 未覆盖范围', '']
  for (const group of groups) {
    const headings = group.headings.length > 0 ? ` · ${paperReviewEscapeMarkdown(group.headings.join('、'))}` : ''
    const pages = group.pageText === '' ? '' : ` · ${paperReviewEscapeMarkdown(group.pageText)}`
    const units = group.unitCount > 1 ? `（${group.unitCount} 个单元）` : ''
    parts.push(`- [${group.artifactLabel}] ${paperReviewEscapeMarkdown(group.action)}${pages}${headings}${units}`)
  }
  parts.push('')
  return parts.join('\n').trim() + '\n'
}

/**
 * English-original appendix in source order with every source unit: headings,
 * paragraphs, and captions show the paired Chinese translation (explicit
 * localized missing line when there is none) and the span-range provenance;
 * preserved-original, excluded, and unresolved units keep the exact original
 * verbatim inside the collision-safe inert code fence with the scope label, a
 * not-translated warning, and the PDF page link. Excluded bibliography /
 * appendix units are never translated — the original is retained. Raw unit
 * ids and the review fingerprint stay in technical details.
 */
export function buildPaperReviewEnglishAppendixMarkdown(result: PaperReviewTaskResult): string {
  const chineseByUnit = new Map(result.translation.pairs.map((pair) => [pair.unitId, pair.chinese] as const))
  const parts: string[] = [
    '## 英文原文对照',
    '',
    '> 以下按源文档顺序列出全部原文单元：标题、段落与图注附对应中文译文（若有）与出处位置；公式、表格内容、页码与参考文献/附录保留原文不翻译，未解析片段未提供译文。',
    '',
  ]
  for (const unit of result.source.units) {
    const chinese = chineseByUnit.get(unit.id) ?? null
    const translated = chinese !== null && chinese.trim() !== ''
    const link = paperReviewPdfPageLink(unit.spans[0]?.readerPage)
    switch (unit.kind) {
      case 'heading':
        parts.push(`### ${paperReviewEscapeHeading(unit.original)}`, '')
        parts.push(translated
          ? `- 中文译文：${paperReviewEscapeMarkdown(chinese ?? '')}`
          : '- 中文译文：暂无（该标题尚无中文译文）')
        parts.push(`- 出处：${paperReviewEscapeMarkdown(readerSpanRangeLabel(unit.spans))}`, '')
        break
      case 'paragraph':
        parts.push(`> 原文：${paperReviewEscapeMarkdown(unit.original)}`, '')
        parts.push(translated
          ? `- 中文译文：${paperReviewEscapeMarkdown(chinese ?? '')}`
          : '- 中文译文：暂无（该段落尚无中文译文）')
        parts.push(`- 出处：${paperReviewEscapeMarkdown(readerSpanRangeLabel(unit.spans))}`, '')
        break
      case 'caption':
        parts.push(`> 图注原文：${paperReviewEscapeMarkdown(unit.original)}`, '')
        parts.push(translated
          ? `- 中文译文：${paperReviewEscapeMarkdown(chinese ?? '')}`
          : '- 中文译文：暂无（该图注尚无中文译文）')
        parts.push(`- 出处：${paperReviewEscapeMarkdown(readerSpanRangeLabel(unit.spans))}`, '')
        break
      case 'preserved-original':
        parts.push(
          `**原文保留（${readerPreservedReasonLabel(unit.reason)}）**${link === '' ? '' : `（${link}）`}`,
          '',
          '> 该单元不翻译，保留原文。',
        )
        if (unit.original.trim() !== '') {
          parts.push('', preservedCodeFence(unit.original))
        }
        parts.push('')
        break
      case 'excluded': {
        const scope = readerExclusionReasonLabel(unit.reason)
        parts.push(`**排除（${scope}）**${link === '' ? '' : `（${link}）`}`, '', `> ${scope}单元未翻译，保留原文。`)
        if (unit.original.trim() !== '') {
          parts.push('', preservedCodeFence(unit.original))
        }
        parts.push('')
        break
      }
      case 'unresolved':
        parts.push(`**未解析**${link === '' ? '' : `（${link}）`}`, '', '> 该片段未被解析，未提供译文。')
        if (unit.original.trim() !== '') {
          parts.push('', preservedCodeFence(unit.original))
        }
        parts.push('')
        break
    }
  }
  return parts.join('\n').trim() + '\n'
}

/** Raw diagnostics: the review fingerprint plus every gap's artifact, code,
 * unit ids, pages, and original reason — separately labeled as technical. */
export function buildPaperReviewTechnicalDetailsMarkdown(result: PaperReviewTaskResult): string {
  const parts: string[] = ['## 技术细节（可选）', '', `- 核验指纹：${paperReviewReviewFingerprint(result)}`, '']
  for (const technical of paperReviewGapTechnicalList(result.gaps)) {
    const units = technical.unitIds.length > 0 ? `（单元 ${technical.unitIds.join('、')}）` : ''
    const pages = technical.pageText === '' ? '' : ` · ${paperReviewEscapeMarkdown(technical.pageText)}`
    const reason = technical.reason === '' ? '' : `：${paperReviewEscapeMarkdown(technical.reason)}`
    parts.push(`- [${technical.artifactLabel}] ${paperReviewEscapeMarkdown(technical.code)}${pages}${units}${reason}`)
  }
  return parts.join('\n').trim() + '\n'
}

/**
 * Rewrites the app-owned `pdf://N` markers in a composed download into a
 * portable relative link (`./<encoded-pdf-name>#page=N`) that resolves against
 * the PDF downloaded into the same folder. Only the app-generated link form
 * `](pdf://N)` matches; escaped model/source text cannot produce one. The
 * on-screen reader keeps the raw marker for the live blob URL resolver.
 */
export function paperReviewPortablePdfLinks(markdown: string, pdfName: string): string {
  const href = `./${encodeURIComponent(pdfName)}`
  return markdown.replace(/\]\(pdf:\/\/(\d+)\)/g, `](${href}#page=$1)`)
}

/** Downloadable report: main body + footnotes + gaps + review + technical details. */
export function buildPaperReviewReportDownloadMarkdown(result: PaperReviewTaskResult, pdfName: string): string {
  const parts = [buildPaperReviewReportMarkdown(result, pdfName)]
  const sources = buildPaperReviewReportSourcesMarkdown(result)
  if (sources !== '') {
    parts.push(sources)
  }
  const gaps = buildPaperReviewGapsMarkdown(result)
  if (gaps !== '') {
    parts.push(gaps)
  }
  parts.push(buildPaperReviewReviewMarkdown(result), buildPaperReviewTechnicalDetailsMarkdown(result))
  return paperReviewPortablePdfLinks(parts.join('\n\n').trim() + '\n', pdfName)
}

/** Downloadable translation: continuous Chinese + gaps + review + English appendix + technical details. */
export function buildPaperReviewTranslationDownloadMarkdown(result: PaperReviewTaskResult, pdfName: string): string {
  const parts = [buildPaperReviewTranslationMarkdown(result, pdfName)]
  const gaps = buildPaperReviewGapsMarkdown(result)
  if (gaps !== '') {
    parts.push(gaps)
  }
  parts.push(
    buildPaperReviewReviewMarkdown(result),
    buildPaperReviewEnglishAppendixMarkdown(result),
    buildPaperReviewTechnicalDetailsMarkdown(result),
  )
  return paperReviewPortablePdfLinks(parts.join('\n\n').trim() + '\n', pdfName)
}

/** Sanitized `.md` download file name; falls back to `论文` for empty names. */
export function paperReviewDownloadFileName(pdfName: string, kind: 'report' | 'translation'): string {
  const safe = pdfName.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').trim().replace(/\s+/g, ' ') || '论文'
  return `${safe}-${kind === 'report' ? '深读报告' : '全文译文'}.md`
}