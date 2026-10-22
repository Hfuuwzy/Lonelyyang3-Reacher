import { describe, expect, it } from 'vitest'
import type {
  PaperReviewTaskGap,
  PaperReviewTaskResult,
  PaperSourceUnit,
} from '../../app/utils/paper-review-task-contract'
import {
  readerExclusionReasonLabel,
  readerExclusionScopeText,
  readerGapArtifactLabel,
  readerGapHeadings,
  readerGapRangeLabel,
  readerPreservedReasonLabel,
  readerReportIncompleteLine,
  readerReviewStatusLabel,
  readerReviewVerdictLabel,
  readerSpanPages,
  readerSpanRangeLabel,
  readerTaskStatusLabel,
  readerUnitKindLabel,
} from '../../app/components/prototype/reader-dossier-labels'

function span(readerPage: number, lineIndex: number, start = 0, end = 10) {
  return { readerPage, lineIndex, start, end }
}

function unit(partial: {
  readonly id: string
  readonly kind: PaperSourceUnit['kind']
  readonly original?: string
  readonly heading?: string
  readonly spans?: ReadonlyArray<ReturnType<typeof span>>
  readonly reason?: string
  readonly mediaReaderPages?: readonly number[]
  readonly headingAnchor?: ReturnType<typeof span>
}): PaperSourceUnit {
  const base = {
    id: partial.id,
    original: partial.original ?? 'original text',
    heading: partial.heading ?? '1 Introduction',
    spans: partial.spans ?? [span(1, 0)],
  }
  switch (partial.kind) {
    case 'caption':
      return { ...base, kind: 'caption', mediaReaderPages: partial.mediaReaderPages ?? [1] }
    case 'excluded':
      return {
        ...base,
        kind: 'excluded',
        reason: partial.reason === 'appendix' ? 'appendix' : 'bibliography',
        headingAnchor: partial.headingAnchor ?? span(2, 7),
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

describe('task/unit kind labels', () => {
  it('maps task status to complete/incomplete copy', () => {
    expect(readerTaskStatusLabel('complete')).toBe('完成')
    expect(readerTaskStatusLabel('incomplete')).toBe('不完整')
  })

  it.each([
    ['paragraph', '段落'],
    ['heading', '标题'],
    ['caption', '图注'],
    ['excluded', '排除'],
    ['preserved-original', '原文保留'],
    ['unresolved', '未解析'],
  ] as const)('maps unit kind %s to %s', (kind, label) => {
    expect(readerUnitKindLabel(kind)).toBe(label)
  })

  it('maps exclusion and preserved reasons', () => {
    expect(readerExclusionReasonLabel('bibliography')).toBe('参考文献')
    expect(readerExclusionReasonLabel('appendix')).toBe('附录')
    expect(readerPreservedReasonLabel('formula')).toBe('公式')
    expect(readerPreservedReasonLabel('table-content')).toBe('表格内容')
    expect(readerPreservedReasonLabel('page-number')).toBe('页码')
  })
})

describe('review status labels', () => {
  it.each([
    ['not-run', '未核验'],
    ['incomplete', '核验不完整'],
    ['passed', '核验通过'],
  ] as const)('maps review status %s to %s', (status, label) => {
    expect(readerReviewStatusLabel(status)).toBe(label)
  })

  it.each([
    ['passed', '通过'],
    ['issues', '存在问题'],
  ] as const)('maps verdict %s to %s', (verdict, label) => {
    expect(readerReviewVerdictLabel(verdict)).toBe(label)
  })

  it('maps gap artifacts', () => {
    expect(readerGapArtifactLabel('source')).toBe('来源')
    expect(readerGapArtifactLabel('report')).toBe('报告')
    expect(readerGapArtifactLabel('translation')).toBe('译文')
    expect(readerGapArtifactLabel('source-review')).toBe('核验')
  })
})

describe('readerSpanRangeLabel', () => {
  it('formats a single-page single-line unit as 阅读页 N · 第 L 行', () => {
    expect(readerSpanRangeLabel([span(2, 3)])).toBe('阅读页 2 · 第 4 行')
  })

  it('formats a multi-line unit as a line range', () => {
    expect(readerSpanRangeLabel([span(1, 1), span(1, 2)])).toBe('阅读页 1 · 第 2–3 行')
  })

  it('formats consecutive cross-page spans as a page range without a cross-page line range', () => {
    expect(readerSpanRangeLabel([span(1, 3), span(2, 0)])).toBe('阅读页 1–2')
  })

  it('formats non-consecutive pages enumerated without a cross-page line range', () => {
    expect(readerSpanRangeLabel([span(1, 0), span(3, 0)])).toBe('阅读页 1、3')
  })

  it('returns a fallback for an empty span list', () => {
    expect(readerSpanRangeLabel([])).toBe('范围未知')
  })

  it('sorts unique reader pages', () => {
    expect(readerSpanPages([span(2, 0), span(1, 0), span(2, 1)])).toEqual([1, 2])
  })
})

describe('readerGapRangeLabel', () => {
  it('prefers the explicit readerPages list', () => {
    const gap: PaperReviewTaskGap = {
      artifact: 'translation',
      code: 'translation-missing',
      origin: 'application',
      unitIds: ['u-2'],
      readerPages: [1, 2],
      spans: [span(1, 1)],
      reason: '缺译文',
    }
    expect(readerGapRangeLabel(gap)).toBe('阅读页 1–2')
  })

  it('falls back to spans when readerPages is empty', () => {
    const gap: PaperReviewTaskGap = {
      artifact: 'source',
      code: 'unresolved-unit',
      origin: 'application',
      unitIds: [],
      readerPages: [],
      spans: [span(2, 3)],
      reason: '未解析',
    }
    expect(readerGapRangeLabel(gap)).toBe('阅读页 2 · 第 4 行')
  })
})

describe('readerGapHeadings', () => {
  it('resolves unique nonblank headings from a gap unit ids in first-seen order', () => {
    const units = [
      unit({ id: 'u-1', kind: 'heading', original: '1 Introduction', heading: '1 Introduction' }),
      unit({ id: 'u-2', kind: 'paragraph', heading: '1 Introduction' }),
      unit({ id: 'u-3', kind: 'paragraph', heading: '2 Methods' }),
      unit({ id: 'u-5', kind: 'paragraph', heading: '   ' }),
    ]
    const gap: PaperReviewTaskGap = {
      artifact: 'translation',
      code: 'translation-missing',
      origin: 'application',
      unitIds: ['u-3', 'u-2', 'u-3', 'u-5', 'u-missing'],
      readerPages: [1, 2],
      spans: [span(1, 1)],
      reason: '缺译文',
    }
    expect(readerGapHeadings(gap, units)).toEqual(['2 Methods', '1 Introduction'])
  })

  it('returns an empty list when the gap has no resolvable or nonblank headings', () => {
    const units = [
      unit({ id: 'u-1', kind: 'paragraph', heading: '   ' }),
      unit({ id: 'u-4', kind: 'excluded', reason: 'bibliography' }),
    ]
    const gap: PaperReviewTaskGap = {
      artifact: 'source',
      code: 'unresolved-unit',
      origin: 'application',
      unitIds: ['u-1', 'u-unknown'],
      readerPages: [],
      spans: [span(2, 3)],
      reason: '未解析',
    }
    expect(readerGapHeadings(gap, units)).toEqual([])
  })

  it('trims surrounding whitespace before matching and reporting headings', () => {
    const units = [unit({ id: 'u-1', kind: 'paragraph', heading: '  Conclusion  ' })]
    const gap: PaperReviewTaskGap = {
      artifact: 'translation',
      code: 'translation-missing',
      origin: 'application',
      unitIds: ['u-1'],
      readerPages: [1],
      spans: [span(1, 1)],
      reason: '缺译文',
    }
    expect(readerGapHeadings(gap, units)).toEqual(['Conclusion'])
  })
})

describe('readerExclusionScopeText', () => {
  it('lists unique excluded scopes in first-seen order', () => {
    const units = [
      unit({ id: 'u-9', kind: 'excluded', reason: 'bibliography' }),
      unit({ id: 'u-10', kind: 'excluded', reason: 'appendix' }),
      unit({ id: 'u-11', kind: 'excluded', reason: 'bibliography' }),
    ]
    expect(readerExclusionScopeText(units)).toBe('已排除范围：参考文献、附录；排除单元不提供译文，保留原文。')
  })

  it('returns an empty string when nothing is excluded', () => {
    expect(readerExclusionScopeText([unit({ id: 'u-1', kind: 'paragraph' })])).toBe('')
  })
})

describe('readerReportIncompleteLine', () => {
  it('names report sections and reasons, grouping identical reasons across scopes', () => {
    expect(readerReportIncompleteLine([
      { section: 'claims', reason: '缺引文' },
      { section: 'methods', reason: '缺引文' },
      { section: 'evidence', reason: '证据不足' },
    ])).toBe('本报告为不完整草稿：论断、方法：缺引文；证据：证据不足')
  })

  it('keeps a single report gap as one scope:reason pair', () => {
    expect(readerReportIncompleteLine([{ section: 'experiments', reason: '缺数据' }]))
      .toBe('本报告为不完整草稿：实验：缺数据')
  })

  it('returns null when only translation failed and the report itself has no gaps', () => {
    const result: PaperReviewTaskResult = {
      status: 'incomplete',
      provider: 'fixture-provider',
      model: 'fixture-model',
      source: { sourceId: 'fixed-29', pageCount: 1, units: [] },
      report: { sections: [], gaps: [] },
      translation: { pairs: [], review: { reviewOf: 'u-2', status: 'incomplete', checks: [] } },
      gaps: [
        {
          artifact: 'translation', code: 'translation-missing', origin: 'application',
          unitIds: ['u-2'], readerPages: [1], spans: [span(1, 1)], reason: '缺译文',
        },
      ],
    }
    expect(readerReportIncompleteLine(result.report?.gaps ?? [])).toBeNull()
  })

  it('returns null when only source review failed and the report itself has no gaps', () => {
    const result: PaperReviewTaskResult = {
      status: 'incomplete',
      provider: 'fixture-provider',
      model: 'fixture-model',
      source: { sourceId: 'fixed-29', pageCount: 1, units: [] },
      report: { sections: [], gaps: [] },
      translation: { pairs: [], review: { reviewOf: 'u-2', status: 'incomplete', checks: [] } },
      gaps: [
        {
          artifact: 'source-review', code: 'review-incomplete', origin: 'application',
          unitIds: ['u-2'], readerPages: [1], spans: [span(1, 1)], reason: '核验中断',
        },
      ],
    }
    expect(readerReportIncompleteLine(result.report?.gaps ?? [])).toBeNull()
  })

  it('keeps unknown report scopes verbatim instead of guessing a label', () => {
    expect(readerReportIncompleteLine([{ section: 'Some Other Scope', reason: '原因' }]))
      .toBe('本报告为不完整草稿：Some Other Scope：原因')
  })
})
