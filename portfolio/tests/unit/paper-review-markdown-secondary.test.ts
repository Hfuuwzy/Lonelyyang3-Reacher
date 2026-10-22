import { describe, expect, it } from 'vitest'
import type { PaperReviewTaskResult, PaperSourceUnit } from '../../app/utils/paper-review-task-contract'
import { renderPaperReviewMarkdown } from '../../app/utils/paper-review-safe-render'
import {
  buildPaperReviewEnglishAppendixMarkdown,
  buildPaperReviewGapsMarkdown,
  buildPaperReviewReportDownloadMarkdown,
  buildPaperReviewReportSourcesMarkdown,
  buildPaperReviewReviewMarkdown,
  buildPaperReviewTechnicalDetailsMarkdown,
  buildPaperReviewTranslationDownloadMarkdown,
  paperReviewDownloadFileName,
  paperReviewPortablePdfLinks,
} from '../../app/utils/paper-review-markdown-secondary'

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
      return {
        ...base,
        kind: 'excluded',
        reason: partial.reason === 'appendix' ? 'appendix' : 'bibliography',
        headingAnchor: span(2, 7),
      }
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

describe('buildPaperReviewReportSourcesMarkdown', () => {
  it('numbers footnotes in the same order as the main-body citation refs', () => {
    const md = buildPaperReviewReportSourcesMarkdown(result({
      report: {
        sections: [
          {
            kind: 'claims', title: '主要论断',
            findings: [
              {
                statement: '第一论断。',
                source: { heading: '1 Introduction', readerPage: 1, quote: 'PDF preserves layout.' },
              },
              {
                statement: '第二论断。',
                source: { heading: '2 Methods', readerPage: 2, printedPage: '5', quote: 'Measured with a timer.' },
              },
            ],
          },
          {
            kind: 'evidence', title: '证据',
            findings: [
              {
                statement: '第三论断。',
                source: { heading: '3 Results', readerPage: 3, quote: 'Accuracy improved.' },
              },
            ],
          },
        ],
        gaps: [],
      },
    }))
    expect(md).toContain('## 出处')
    expect(md).toContain('[1] 出处：1 Introduction · 阅读页 1 · [原文 PDF 第 1 页](pdf://1)')
    expect(md).toContain('> PDF preserves layout.')
    expect(md).toContain('[2] 出处：2 Methods · 阅读页 2 · 印刷页 5 · [原文 PDF 第 2 页](pdf://2)')
    expect(md).toContain('[3] 出处：3 Results · 阅读页 3 · [原文 PDF 第 3 页](pdf://3)')
    expect(md.indexOf('[1]')).toBeLessThan(md.indexOf('[2]'))
    expect(md.indexOf('[2]')).toBeLessThan(md.indexOf('[3]'))
  })

  it('returns an empty string when the report has no findings', () => {
    expect(buildPaperReviewReportSourcesMarkdown(result({ report: null }))).toBe('')
    expect(buildPaperReviewReportSourcesMarkdown(result({
      report: { sections: [{ kind: 'claims', title: 't', findings: [] }], gaps: [] },
    }))).toBe('')
  })
})

describe('buildPaperReviewReviewMarkdown', () => {
  it('writes human counts and grouped verdict lines, never the fingerprint', () => {
    const md = buildPaperReviewReviewMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 4,
        units: [
          unit({ id: 'u-1', kind: 'paragraph', heading: '1 Introduction', spans: [span(1, 0)] }),
          unit({ id: 'u-2', kind: 'paragraph', heading: '1 Introduction', spans: [span(1, 1)] }),
        ],
      },
      translation: {
        pairs: [],
        review: {
          reviewOf: 'sha256-digest',
          status: 'incomplete',
          checks: [
            { unitId: 'u-1', verdict: 'passed' },
            { unitId: 'u-2', verdict: 'issues' },
          ],
        },
      },
    }))
    expect(md).toContain('> 核验状态：核验不完整：1 / 2 通过，1 项存在问题')
    expect(md).toContain('- 通过：1 Introduction · 第 1 页')
    expect(md).toContain('- 存在问题：1 Introduction · 第 1 页')
    expect(md).not.toContain('sha256-digest')
    expect(md).not.toContain('u-1')
    expect(md).not.toContain('u-2')
  })

  it('notes when no verification ran', () => {
    const md = buildPaperReviewReviewMarkdown(result())
    expect(md).toContain('> 核验状态：未核验：本次未进行原文对照复检')
  })
})

describe('buildPaperReviewGapsMarkdown', () => {
  it('writes one aggregated human line per gap group with Chinese actions', () => {
    const md = buildPaperReviewGapsMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 4,
        units: [unit({ id: 'u-1', kind: 'paragraph', heading: '2 Methods', spans: [span(2, 0)] })],
      },
      gaps: [
        {
          artifact: 'translation', code: 'missing-translation', origin: 'application',
          unitIds: ['u-1'], readerPages: [2], spans: [span(2, 0)], reason: 'translation: missing-translation',
        },
      ],
    }))
    expect(md).toContain('## 未覆盖范围')
    expect(md).toContain('- [译文] 该单元没有返回译文 · 第 2 页 · 2 Methods')
    expect(md).not.toContain('missing-translation')
    expect(md).not.toContain('u-1')
  })

  it('returns an empty string when there are no gaps', () => {
    expect(buildPaperReviewGapsMarkdown(result())).toBe('')
  })
})

describe('buildPaperReviewEnglishAppendixMarkdown', () => {
  it('retains every source kind: eligible units with paired Chinese, preserved/excluded/unresolved raw in fences', () => {
    const md = buildPaperReviewEnglishAppendixMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 3,
        units: [
          unit({ id: 'u-1', kind: 'heading', original: '1 Introduction', spans: [span(1, 0)] }),
          unit({ id: 'u-2', kind: 'paragraph', original: 'PDF preserves layout.', spans: [span(1, 1), span(1, 2)] }),
          unit({ id: 'u-3', kind: 'caption', original: 'Figure 1 caption.', spans: [span(2, 3)] }),
          unit({ id: 'u-4', kind: 'preserved-original', reason: 'formula', original: 'E = mc^2', spans: [span(2, 6)] }),
          unit({ id: 'u-5', kind: 'preserved-original', reason: 'table-content', original: 'A | B', spans: [span(2, 7)] }),
          unit({ id: 'u-6', kind: 'preserved-original', reason: 'page-number', original: '12', spans: [span(2, 8)] }),
          unit({ id: 'u-7', kind: 'excluded', reason: 'bibliography', original: '[1] Ref A', spans: [span(3, 1)] }),
          unit({ id: 'u-8', kind: 'excluded', reason: 'appendix', original: 'Appendix A', spans: [span(3, 2)] }),
          unit({ id: 'u-9', kind: 'unresolved', original: '???', spans: [span(3, 5)] }),
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
    }))

    // Heading: paired Chinese and span provenance, heading not lost.
    expect(md).toContain('### 1 Introduction')
    expect(md).toContain('- 中文译文：导言')
    expect(md).toContain('- 出处：阅读页 1 · 第 1 行')
    // Paragraph and caption: english original plus paired/explicit-missing Chinese.
    expect(md).toContain('> 原文：PDF preserves layout.')
    expect(md).toContain('- 中文译文：PDF 以保留印刷布局为目标。')
    expect(md).toContain('- 出处：阅读页 1 · 第 2–3 行')
    expect(md).toContain('> 图注原文：Figure 1 caption.')
    expect(md).toContain('- 中文译文：暂无（该图注尚无中文译文）')
    // Preserved kinds: scope label, not-translated warning, page link, raw original.
    expect(md).toContain('**原文保留（公式）**（[原文 PDF 第 2 页](pdf://2)）')
    expect(md).toContain('> 该单元不翻译，保留原文。')
    expect(md).toContain('E = mc^2')
    expect(md).toContain('**原文保留（表格内容）**（[原文 PDF 第 2 页](pdf://2)）')
    expect(md).toContain('A | B')
    expect(md).toContain('**原文保留（页码）**（[原文 PDF 第 2 页](pdf://2)）')
    expect(md).toContain('12')
    // Excluded: never translated, original retained, no discard wording.
    expect(md).toContain('**排除（参考文献）**（[原文 PDF 第 3 页](pdf://3)）')
    expect(md).toContain('> 参考文献单元未翻译，保留原文。')
    expect(md).toContain('[1] Ref A')
    expect(md).toContain('**排除（附录）**（[原文 PDF 第 3 页](pdf://3)）')
    expect(md).toContain('> 附录单元未翻译，保留原文。')
    expect(md).toContain('Appendix A')
    expect(md).not.toContain('已丢弃')
    expect(md).not.toContain('discarded')
    // Unresolved: warning plus raw original.
    expect(md).toContain('**未解析**（[原文 PDF 第 3 页](pdf://3)）')
    expect(md).toContain('> 该片段未被解析，未提供译文。')
    expect(md).toContain('???')
    // Raw unit ids never surface in the appendix labels.
    expect(md).not.toContain('u-1')
    expect(md).not.toContain('u-9')
  })

  it('marks missing translations explicitly without dropping the english original', () => {
    const md = buildPaperReviewEnglishAppendixMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [
          unit({ id: 'u-1', kind: 'heading', original: '1 Introduction', spans: [span(1, 0)] }),
          unit({ id: 'u-2', kind: 'paragraph', original: 'PDF text.', spans: [span(1, 1)] }),
        ],
      },
      translation: { pairs: [{ unitId: 'u-2', chinese: null }], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }))
    expect(md).toContain('### 1 Introduction')
    expect(md).toContain('- 中文译文：暂无（该标题尚无中文译文）')
    expect(md).toContain('> 原文：PDF text.')
    expect(md).toContain('- 中文译文：暂无（该段落尚无中文译文）')
  })

  it('wraps unsafe-markup raw originals in a strictly longer inert fence verbatim', () => {
    const original = '<b>bold</b> & [link](url) with `tick` and ``` triple'
    const md = buildPaperReviewEnglishAppendixMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-4', kind: 'preserved-original', reason: 'table-content', original, spans: [span(1, 1)] })],
      },
      translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }))
    // The exact original survives as one verbatim substring.
    expect(md.indexOf(original)).toBeGreaterThan(-1)
    // Fence length strictly exceeds the longest backtick run inside (``` => four backticks).
    expect(md).toContain(`\n\`\`\`\`\n${original}\n\`\`\`\`\n`)
  })

  it('renders appendix markup inert through the safe renderer without losing headings', () => {
    const md = buildPaperReviewEnglishAppendixMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [
          unit({ id: 'u-1', kind: 'heading', original: '1 Introduction', spans: [span(1, 0)] }),
          unit({
            id: 'u-2', kind: 'preserved-original', reason: 'formula', original: '<b>bold</b> & E = mc^2', spans: [span(1, 2)],
          }),
        ],
      },
      translation: { pairs: [{ unitId: 'u-1', chinese: '导言' }], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }))
    const rendered = renderPaperReviewMarkdown(md, 'blob:pdf-url')
    // The heading survived as a real heading.
    expect(rendered.html).toContain('<h3')
    // Raw markup inside the fence is inert escaped text, never a live element.
    expect(rendered.html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(rendered.html).not.toContain('<b>bold</b>')
  })
})

describe('buildPaperReviewTechnicalDetailsMarkdown', () => {
  it('surfaces the fingerprint, raw codes, unit ids, pages, and reasons', () => {
    const md = buildPaperReviewTechnicalDetailsMarkdown(result({
      translation: { pairs: [], review: { reviewOf: 'sha256-digest', status: 'incomplete', checks: [] } },
      gaps: [
        {
          artifact: 'source', code: 'unresolved-source', origin: 'application',
          unitIds: ['u-9'], readerPages: [2], spans: [span(2, 3)], reason: 'source: unresolved-source',
        },
      ],
    }))
    expect(md).toContain('## 技术细节（可选）')
    expect(md).toContain('- 核验指纹：sha256-digest')
    expect(md).toContain('- [来源] unresolved-source · 第 2 页（单元 u-9）：source: unresolved-source')
  })
})

describe('download documents and file names', () => {
  it('report download appends footnotes, gaps, review, and technical details', () => {
    const md = buildPaperReviewReportDownloadMarkdown(result({
      report: {
        sections: [{
          kind: 'claims', title: '主要论断',
          findings: [{ statement: '论断。', source: { heading: '1 Introduction', readerPage: 1, quote: 'Quote.' } }],
        }],
        gaps: [],
      },
    }), 'survey.pdf')
    expect(md).toContain('# survey.pdf')
    expect(md).toContain('## 出处')
    expect(md).toContain('## 核验状态')
    expect(md).toContain('## 技术细节（可选）')
  })

  it('translation download appends gaps, review, appendix, and technical details', () => {
    const md = buildPaperReviewTranslationDownloadMarkdown(result({
      gaps: [{
        artifact: 'source', code: 'unresolved-source', origin: 'application',
        unitIds: ['u-2'], readerPages: [1], spans: [span(1, 1)], reason: 'source: unresolved-source',
      }],
    }), 'survey.pdf')
    expect(md).toContain('## 未覆盖范围')
    expect(md).toContain('## 核验状态')
    expect(md).toContain('## 英文原文对照')
    expect(md).toContain('## 技术细节（可选）')
  })

  it('sanitizes the pdf name for the download file name and falls back for empty names', () => {
    expect(paperReviewDownloadFileName('a/b:c*.pdf', 'report')).toBe('a b c .pdf-深读报告.md')
    expect(paperReviewDownloadFileName('', 'translation')).toBe('论文-全文译文.md')
    expect(paperReviewDownloadFileName('survey.pdf', 'report')).toBe('survey.pdf-深读报告.md')
  })
})

describe('portable pdf links in downloads', () => {
  it('rewrites every app-generated pdf://N marker into ./encoded-name#page=N', () => {
    const md = buildPaperReviewReportDownloadMarkdown(result({
      report: {
        sections: [{
          kind: 'claims', title: '主要论断',
          findings: [{ statement: '论断。', source: { heading: '1 Introduction', readerPage: 3, quote: 'Quote.' } }],
        }],
        gaps: [],
      },
    }), 'survey.pdf')
    expect(md).toContain('[原文 PDF 第 3 页](./survey.pdf#page=3)')
    expect(md).not.toContain('(pdf://')
  })

  it('encodes Chinese file names and spaces in the portable href', () => {
    const md = buildPaperReviewTranslationDownloadMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 1,
        units: [unit({ id: 'u-4', kind: 'preserved-original', reason: 'formula', original: 'E = mc^2', spans: [span(1, 5)] })],
      },
    }), '论文 摘要.pdf')
    expect(md).toContain(`[原文 PDF 第 1 页](./${encodeURIComponent('论文 摘要.pdf')}#page=1)`)
  })

  it('rewrites appendix pdf://N links for preserved, excluded, and unresolved units', () => {
    const md = buildPaperReviewTranslationDownloadMarkdown(result({
      source: {
        sourceId: 'fixture', pageCount: 2,
        units: [
          unit({ id: 'u-4', kind: 'preserved-original', reason: 'formula', original: 'E = mc^2', spans: [span(1, 5)] }),
          unit({ id: 'u-7', kind: 'excluded', reason: 'bibliography', original: '[1] Ref A', spans: [span(2, 1)] }),
          unit({ id: 'u-9', kind: 'unresolved', original: '???', spans: [span(2, 5)] }),
        ],
      },
      translation: { pairs: [], review: { reviewOf: 'digest', status: 'not-run', checks: [] } },
    }), 'survey.pdf')
    expect(md).toContain('[原文 PDF 第 1 页](./survey.pdf#page=1)')
    expect(md).toContain('[原文 PDF 第 2 页](./survey.pdf#page=2)')
    expect(md).not.toContain('(pdf://')
  })

  it('keeps the document first H1 in the export after the rewrite', () => {
    const md = buildPaperReviewReportDownloadMarkdown(result({ report: null }), 'survey.pdf')
    expect(md.startsWith('# survey.pdf')).toBe(true)
  })

  it('never rewrites a plain-text pdf:// literal into a link', () => {
    expect(paperReviewPortablePdfLinks('正文 [a](pdf://2) 与字面 pdf://3', 'x.pdf'))
      .toBe('正文 [a](./x.pdf#page=2) 与字面 pdf://3')
  })
})