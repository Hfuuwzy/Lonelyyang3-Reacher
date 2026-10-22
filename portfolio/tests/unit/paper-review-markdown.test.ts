import { describe, expect, it } from 'vitest'
import type { PaperReviewTaskResult, PaperSourceUnit } from '../../app/utils/paper-review-task-contract'
import {
  buildPaperReviewReportMarkdown,
  buildPaperReviewTranslationMarkdown,
  paperReviewEscapeHeading,
  paperReviewEscapeMarkdown,
  paperReviewPdfPageHref,
  paperReviewPdfPageLink,
  preservedCodeFence,
} from '../../app/utils/paper-review-markdown'

function span(readerPage: number, lineIndex = 0, start = 0, end = 10) {
  return { readerPage, lineIndex, start, end }
}

function unit(partial: {
  readonly id: string
  readonly kind: PaperSourceUnit['kind']
  readonly original?: string
  readonly heading?: string
  readonly spans?: ReadonlyArray<ReturnType<typeof span>>
  readonly reason?: string
}): PaperSourceUnit {
  const base = {
    id: partial.id,
    original: partial.original ?? 'original text',
    heading: partial.heading ?? '1 Introduction',
    spans: partial.spans ?? [span(1, 0)],
  }
  switch (partial.kind) {
    case 'caption':
      return { ...base, kind: 'caption', mediaReaderPages: [1] }
    case 'excluded':
      return { ...base, kind: 'excluded', reason: partial.reason === 'appendix' ? 'appendix' : 'bibliography', headingAnchor: span(2, 7) }
    case 'preserved-original':
      return {
        ...base,
        kind: 'preserved-original',
        reason: partial.reason === 'table-content' || partial.reason === 'page-number' ? partial.reason : 'formula',
      }
    default:
      return { ...base, kind: partial.kind }
  }
}

function result(overrides: Partial<PaperReviewTaskResult> = {}): PaperReviewTaskResult {
  return {
    status: 'incomplete',
    provider: 'fixture-provider',
    model: 'fixture-model',
    source: { sourceId: 'fixture', pageCount: 4, units: [] },
    report: { sections: [], gaps: [] },
    translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    gaps: [],
    ...overrides,
  }
}

describe('paperReviewEscapeMarkdown / paperReviewEscapeHeading', () => {
  it('escapes markdown and raw-HTML specials of model prose', () => {
    expect(paperReviewEscapeMarkdown('<b>bold</b> and [link](url) and `code`')).toBe(
      '\\<b\\>bold\\</b\\> and \\[link\\]\\(url\\) and \\`code\\`',
    )
  })

  it('normalizes CRLF and CR line endings', () => {
    expect(paperReviewEscapeMarkdown('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('escapes heading markers and collapses newlines', () => {
    expect(paperReviewEscapeHeading('# Title\nnext')).toBe('\\# Title next')
  })

  it('escapes line-leading and inline # so model text can never become a heading', () => {
    expect(paperReviewEscapeMarkdown('# 重要内容')).toBe('\\# 重要内容')
    expect(paperReviewEscapeMarkdown('第一行\n# 第二行\n## 小标题')).toBe('第一行\n\\# 第二行\n\\#\\# 小标题')
  })

  it('a paragraph whose Chinese starts with # stays visible, never a dropped h1', () => {
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-1', kind: 'paragraph', original: 'x', spans: [span(1, 0)] })],
      },
      translation: {
        pairs: [{ unitId: 'u-1', chinese: '# 重要内容\n继续同一段' }],
        review: { reviewOf: 'digest', status: 'not-run', checks: [] },
      },
    }), 'survey.pdf')
    expect(md).toContain('\\# 重要内容')
    expect(md).not.toContain('## 重要内容')
  })
})

describe('paperReviewPdfPageHref / paperReviewPdfPageLink', () => {
  it('emits the pdf://N marker for positive integer pages', () => {
    expect(paperReviewPdfPageHref(2)).toBe('pdf://2')
    expect(paperReviewPdfPageLink(2)).toBe('[原文 PDF 第 2 页](pdf://2)')
  })

  it('returns an empty string for invalid or missing pages', () => {
    expect(paperReviewPdfPageHref(undefined)).toBe('')
    expect(paperReviewPdfPageHref(0)).toBe('')
    expect(paperReviewPdfPageHref(-1)).toBe('')
    expect(paperReviewPdfPageHref(1.5)).toBe('')
    expect(paperReviewPdfPageLink(undefined)).toBe('')
  })
})

describe('preservedCodeFence', () => {
  it('is exported for the secondary appendix and wraps the exact original in a strictly longer fence', () => {
    expect(preservedCodeFence('a `tick` and ``` triple')).toBe('````\na `tick` and ``` triple\n````')
  })
})

describe('buildPaperReviewReportMarkdown', () => {
  it('writes title, meta, verification note, and continuous sections with numbered citation refs', () => {
    const md = buildPaperReviewReportMarkdown(result({
      status: 'incomplete',
      report: {
        sections: [
          {
            kind: 'claims',
            title: '主要论断',
            findings: [
              {
                statement: '论文以印刷布局保留为目标呈现 PDF 文本。',
                source: { heading: '1 Introduction', readerPage: 1, quote: 'PDF preserves layout.' },
              },
              {
                statement: '第二论断。',
                source: { heading: '2 Methods', readerPage: 2, printedPage: '5', quote: 'Measured with a timer.' },
              },
            ],
          },
          {
            kind: 'methods',
            title: '方法',
            findings: [],
          },
        ],
        gaps: [],
      },
    }), 'survey.pdf')

    expect(md.startsWith('# survey.pdf')).toBe(true)
    expect(md).toContain('> 提供方 fixture-provider · 模型 fixture-model · 任务状态：不完整')
    expect(md).toContain('> 核验说明：本报告仅核验引文')
    expect(md).toContain('## 论断 · 主要论断')
    expect(md).toContain('论文以印刷布局保留为目标呈现 PDF 文本。 [1]')
    expect(md).toContain('第二论断。 [2]')
    expect(md).toContain('> 本节没有产出任何论断。')
    // The numbered refs come first in the main body; the quoted sources belong
    // to the secondary footnotes — no inline English quote here.
    expect(md).not.toContain('> PDF preserves layout.')
    expect(md).not.toContain('出处：')
    // Sections stay in the contract order.
    const methodsIndex = md.indexOf('## 方法 · 方法')
    expect(methodsIndex).toBeGreaterThan(md.indexOf('## 论断 · 主要论断'))
  })

  it('adds a concise incomplete notice aggregated from the report gaps', () => {
    const md = buildPaperReviewReportMarkdown(result({
      report: {
        sections: [],
        gaps: [
          { section: 'claims', reason: '未能核验引文' },
          { section: 'methods', reason: '未能核验引文' },
        ],
      },
    }), 'survey.pdf')
    expect(md).toContain('> 本报告为不完整草稿：论断、方法：未能核验引文')
  })

  it('states plainly when no report was generated', () => {
    const md = buildPaperReviewReportMarkdown(result({ report: null }), 'survey.pdf')
    expect(md).toContain('> 本次任务未生成深读报告。')
  })
})

describe('buildPaperReviewTranslationMarkdown', () => {
  it('keeps source order and renders continuous Chinese with per-unit formula/table links', () => {
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 4,
        units: [
          unit({ id: 'u-1', kind: 'heading', original: '1 Introduction' }),
          unit({ id: 'u-2', kind: 'paragraph', original: 'PDF preserves layout.', spans: [span(1, 1)] }),
          unit({ id: 'u-3', kind: 'caption', original: 'Figure 1 caption.', spans: [span(2, 2)] }),
          unit({ id: 'u-4', kind: 'preserved-original', reason: 'formula', original: 'E = mc^2', spans: [span(2, 6)] }),
          unit({ id: 'u-5', kind: 'preserved-original', reason: 'table-content', original: 'A | B', spans: [span(2, 7)] }),
        ],
      },
      translation: {
        pairs: [
          { unitId: 'u-1', chinese: '导言' },
          { unitId: 'u-2', chinese: 'PDF 以保留印刷布局为目标。' },
          { unitId: 'u-3', chinese: null },
        ],
        review: { reviewOf: 'digest', status: 'not-run', checks: [] },
      },
    }), 'survey.pdf')

    const headingIndex = md.indexOf('## 导言')
    const paragraphIndex = md.indexOf('PDF 以保留印刷布局为目标。')
    const captionIndex = md.indexOf('> 译文缺失：该图注尚无中文译文。[原文 PDF 第 2 页](pdf://2)')
    const formulaIndex = md.indexOf('E = mc^2')
    const tableIndex = md.indexOf('A | B')
    expect(headingIndex).toBeGreaterThan(-1)
    expect(headingIndex).toBeLessThan(paragraphIndex)
    expect(paragraphIndex).toBeLessThan(captionIndex)
    expect(captionIndex).toBeLessThan(formulaIndex)
    expect(formulaIndex).toBeLessThan(tableIndex)
    expect(md).toContain('**原文保留（公式）**（[原文 PDF 第 2 页](pdf://2)）')
    expect(md).toContain('**原文保留（表格内容）**（[原文 PDF 第 2 页](pdf://2)）')
  })

  it('keeps a multi-line formula/table original verbatim inside a strictly longer fence', () => {
    const original = 'Method | Accuracy\nCalibrated | 92.4%\nE = mc^2\n```\ninner fence\n```\n`tick`'
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-4', kind: 'preserved-original', reason: 'table-content', original, spans: [span(1, 1)] })],
      },
      translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }), 'survey.pdf')
    // The exact original (pipes, backslashes, ticks, newlines) survives unchanged.
    expect(md.indexOf(original)).toBeGreaterThan(-1)
    // Fence length strictly exceeds the longest backtick run inside (``` => four backticks).
    expect(md).toContain(`\n\`\`\`\`\n${original}\n\`\`\`\`\n`)
  })

  it('summarizes exclusions, page numbers, and unresolved fragments once instead of per-unit spam', () => {
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 4,
        units: [
          unit({ id: 'u-1', kind: 'excluded', reason: 'bibliography', original: '[1] Ref A', spans: [span(1, 8)] }),
          unit({ id: 'u-2', kind: 'excluded', reason: 'appendix', original: 'Appendix', spans: [span(1, 9)] }),
          unit({ id: 'u-3', kind: 'preserved-original', reason: 'page-number', spans: [span(1, 0)] }),
          unit({ id: 'u-4', kind: 'unresolved', original: '???', spans: [span(1, 3)] }),
        ],
      },
      translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }), 'survey.pdf')

    expect(md).toContain('> 已排除范围：参考文献、附录；排除单元不提供译文，保留原文。')
    expect(md).toContain('> 原文保留：页码等版式元素共 1 处，保留原文不翻译。')
    expect(md).toContain('> 未解析：1 个原文片段未被解析，未提供译文。')
    expect(md).not.toContain('已排除（参考文献）')
    expect(md).not.toContain('原文保留（页码）')
    expect(md).not.toContain('未解析：该单元')
  })

  it('a missing paragraph is an explicit localized notice with a PDF link, never skipped', () => {
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-2', kind: 'paragraph', original: 'PDF text.', spans: [span(1, 1)] })],
      },
      translation: { pairs: [{ unitId: 'u-2', chinese: null }], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }), 'survey.pdf')
    expect(md).toContain('> 译文缺失：该段落尚无中文译文。[原文 PDF 第 1 页](pdf://1)')
  })

  it('a missing heading falls back to the original heading text with a notice', () => {
    const md = buildPaperReviewTranslationMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-1', kind: 'heading', original: '1 Introduction' })],
      },
      translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }), 'survey.pdf')
    expect(md).toContain('## 1 Introduction')
    expect(md).toContain('> 该标题尚无中文译文。[原文 PDF 第 1 页](pdf://1)')
  })
})