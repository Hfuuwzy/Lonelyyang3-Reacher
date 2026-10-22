/**
 * App-side pure Markdown projection for the paper-review readers: the primary
 * continuous documents only.
 *
 * Browser-safe: no DOM, no fetch, no Node APIs — every function is
 * unit-testable in the node vitest environment. Turns the validated
 * `PaperReviewTaskResult` contract into:
 *
 * - the deep-read report main body (sections with numbered `[n]` citation
 *   refs; the quoted sources live in the secondary footnotes built by
 *   `paper-review-markdown-secondary.ts`), and
 * - the continuous Chinese translation (source-order units; formulas and table
 *   content preserved verbatim in inert code fences with PDF page links; page
 *   numbers, excluded bibliography/appendix units, and unresolved fragments
 *   summarized once instead of repeating per-unit notices; missing translations
 *   get an explicit localized notice).
 *
 * All model-provided prose is escaped before embedding (`paperReviewEscapeMarkdown`),
 * so raw HTML, MDC components, links, images, and line-leading `#` inside model
 * text are inert in the generated document; the only links emitted are
 * app-controlled `pdf://N` markers resolved by the safe renderer to the live
 * PDF object URL.
 *
 * Secondary sections (sources/footnotes, human review, human gaps, English
 * appendix, technical details) and the download composition live in
 * `paper-review-markdown-secondary.ts`.
 */

import type { PaperReviewTaskResult, PaperSourceUnit } from './paper-review-task-contract'
import { paperReviewSectionKindLabel } from '../components/prototype/paper-review-labels'
import {
  readerExclusionScopeText,
  readerReportIncompleteLine,
  readerTaskStatusLabel,
} from '../components/prototype/reader-dossier-labels'

/** Escapes Markdown/raw-HTML specials of model prose; `<`/`>`/`[`/`]`/`(`/`)`/`#` keep any embedded markup inert. */
export function paperReviewEscapeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/([\\`*_[\]()<>|#])/g, '\\$1')
}

/** Heading-safe variant: newlines collapse to spaces; `#` is escaped by the shared set. */
export function paperReviewEscapeHeading(text: string): string {
  return paperReviewEscapeMarkdown(text).replace(/\n/g, ' ').trim()
}

/** `pdf://N` marker resolved by the safe renderer to `${pdfUrl}#page=N`; empty string when no page. */
export function paperReviewPdfPageHref(page: number | undefined): string {
  if (page === undefined || !Number.isInteger(page) || page < 1) {
    return ''
  }
  return `pdf://${page}`
}

/** `[原文 PDF 第 N 页](pdf://N)` link marker; empty string when no page. */
export function paperReviewPdfPageLink(page: number | undefined): string {
  const href = paperReviewPdfPageHref(page)
  if (href === '') {
    return ''
  }
  return `[原文 PDF 第 ${page} 页](${href})`
}

/** Longest run of consecutive backticks in a string; 0 when there are none. */
function longestBacktickRun(text: string): number {
  let max = 0
  let run = 0
  for (const char of text) {
    if (char === '`') {
      run += 1
      if (run > max) {
        max = run
      }
    } else {
      run = 0
    }
  }
  return max
}

/**
 * Fenced code block around verbatim preserved source (formulas, table
 * interiors): the fence is strictly longer than any backtick run inside, so
 * the exact original can never break the fence, and markup stays inert text.
 * Exported so the secondary English appendix reuses the same collision-safe
 * fence for preserved-original, excluded, and unresolved raw originals.
 */
export function preservedCodeFence(original: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(original) + 1))
  return `${fence}\n${original}\n${fence}`
}

/** First span reader page of a source unit, or undefined when the unit has no spans. */
function unitPage(unit: PaperSourceUnit): number | undefined {
  return unit.spans[0]?.readerPage
}

/**
 * Report main body: title, meta, verification note, a concise incomplete
 * notice, and continuous section paragraphs whose findings carry numbered
 * `[n]` citation refs. The quoted sources with their locations are only in the
 * secondary footnotes; the task gaps are only in the disclosure.
 */
export function buildPaperReviewReportMarkdown(result: PaperReviewTaskResult, pdfName: string): string {
  const parts: string[] = [
    `# ${paperReviewEscapeHeading(pdfName)}`,
    '',
    `> ${paperReviewEscapeMarkdown(`提供方 ${result.provider} · 模型 ${result.model} · 任务状态：${readerTaskStatusLabel(result.status)}`)}`,
    '',
    '> 核验说明：本报告仅核验引文与 PDF 原文在标注阅读页上的逐字一致性；出处匹配不代表论断在原文中获得语义支持，亦不代表结论成立或全文内容已覆盖。',
    '',
  ]

  if (result.report === null) {
    parts.push('> 本次任务未生成深读报告。', '')
    return parts.join('\n').trim() + '\n'
  }

  const incompleteLine = readerReportIncompleteLine(result.report.gaps)
  if (incompleteLine !== null) {
    parts.push(`> ${paperReviewEscapeMarkdown(incompleteLine)}`, '')
  }

  let citation = 0
  for (const section of result.report.sections) {
    const kind = paperReviewSectionKindLabel(section.kind)
    parts.push(`## ${paperReviewEscapeHeading(`${kind} · ${section.title}`)}`, '')
    if (section.findings.length === 0) {
      parts.push('> 本节没有产出任何论断。', '')
      continue
    }
    for (const finding of section.findings) {
      citation += 1
      parts.push(`${paperReviewEscapeMarkdown(finding.statement)} [${citation}]`, '')
    }
    parts.push('')
  }

  return parts.join('\n').trim() + '\n'
}

/**
 * Continuous Chinese translation in source order: headings and paragraphs read
 * as one article; formulas and table content are preserved verbatim with a PDF
 * page link; page numbers, excluded bibliography/appendix units, and unresolved
 * fragments are summarized once; missing translations get an explicit localized
 * notice instead of being silently skipped.
 */
export function buildPaperReviewTranslationMarkdown(result: PaperReviewTaskResult, pdfName: string): string {
  const chineseByUnit = new Map(result.translation.pairs.map((pair) => [pair.unitId, pair.chinese] as const))
  const parts: string[] = [
    `# ${paperReviewEscapeHeading(pdfName)}`,
    '',
    `> ${paperReviewEscapeMarkdown(`全文译文 · 提供方 ${result.provider} · 模型 ${result.model} · 任务状态：${readerTaskStatusLabel(result.status)}`)}`,
    '',
  ]

  let pageNumberCount = 0
  let unresolvedCount = 0
  for (const unit of result.source.units) {
    const chinese = chineseByUnit.get(unit.id) ?? null
    const translated = chinese !== null && chinese.trim() !== ''
    const page = unitPage(unit)
    const link = paperReviewPdfPageLink(page)
    switch (unit.kind) {
      case 'heading':
        if (translated) {
          parts.push(`## ${paperReviewEscapeHeading(chinese ?? '')}`)
        } else {
          parts.push(`## ${paperReviewEscapeHeading(unit.original)}`, '')
          parts.push(`> 该标题尚无中文译文。${link}`)
        }
        parts.push('')
        break
      case 'paragraph':
        if (translated) {
          parts.push(paperReviewEscapeMarkdown(chinese ?? ''))
        } else {
          parts.push(`> 译文缺失：该段落尚无中文译文。${link}`)
        }
        parts.push('')
        break
      case 'caption':
        if (translated) {
          parts.push(`**图注**：${paperReviewEscapeMarkdown(chinese ?? '')}${link === '' ? '' : `（${link}）`}`)
        } else {
          parts.push(`> 译文缺失：该图注尚无中文译文。${link}`)
        }
        parts.push('')
        break
      case 'preserved-original':
        if (unit.reason === 'page-number') {
          pageNumberCount += 1
          break
        }
        // Exact source in an inert code fence: pipes, backslashes, ticks, and
        // multi-line interiors survive verbatim in the .md and on screen.
        parts.push(
          `**原文保留（${preservedReasonLabel(unit.reason)}）**${link === '' ? '' : `（${link}）`}`,
          '',
          preservedCodeFence(unit.original),
          '',
        )
        break
      case 'excluded':
        // Excluded units are summarized once below, never spammed per unit.
        break
      case 'unresolved':
        unresolvedCount += 1
        break
    }
  }

  const exclusionScope = readerExclusionScopeText(result.source.units)
  if (exclusionScope !== '') {
    parts.push(`> ${paperReviewEscapeMarkdown(exclusionScope)}`, '')
  }
  if (pageNumberCount > 0) {
    parts.push(`> 原文保留：页码等版式元素共 ${pageNumberCount} 处，保留原文不翻译。`, '')
  }
  if (unresolvedCount > 0) {
    parts.push(`> 未解析：${unresolvedCount} 个原文片段未被解析，未提供译文。`, '')
  }
  return parts.join('\n').trim() + '\n'
}

function preservedReasonLabel(reason: 'formula' | 'table-content'): string {
  return reason === 'formula' ? '公式' : '表格内容'
}