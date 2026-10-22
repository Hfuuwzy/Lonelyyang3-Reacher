import { describe, expect, it } from 'vitest'
import type { PaperReviewTaskResult, PaperSourceUnit } from '../../app/utils/paper-review-task-contract'
import {
  paperReviewGapCodeAction,
  paperReviewHumanGapGroups,
  paperReviewPageRangeText,
  paperReviewReviewCheckGroups,
  paperReviewReviewCounts,
  paperReviewReviewStatusLine,
} from '../../app/utils/paper-review-gaps'

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
      return { ...base, kind: 'excluded', reason: 'bibliography', headingAnchor: span(2, 7) }
    case 'preserved-original':
      return { ...base, kind: 'preserved-original', reason: partial.reason === 'table-content' ? 'table-content' : 'formula' }
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

describe('paperReviewPageRangeText', () => {
  it('renders single, contiguous, and gapped pages', () => {
    expect(paperReviewPageRangeText([2])).toBe('第 2 页')
    expect(paperReviewPageRangeText([1, 2, 3])).toBe('第 1–3 页')
    expect(paperReviewPageRangeText([1, 3, 4])).toBe('第 1、3–4 页')
    expect(paperReviewPageRangeText([])).toBe('')
    expect(paperReviewPageRangeText([2, 2, 1])).toBe('第 1–2 页')
  })
})

describe('paperReviewGapCodeAction', () => {
  it('maps known codes to Chinese actions', () => {
    expect(paperReviewGapCodeAction('missing-translation')).toBe('该单元没有返回译文')
    expect(paperReviewGapCodeAction('review-issues')).toBe('该单元核验存在问题')
    expect(paperReviewGapCodeAction('unresolved-source')).toBe('原文片段未被解析，无法参与抽取或翻译')
  })

  it('maps extractor/review/pipeline codes to Chinese actions', () => {
    expect(paperReviewGapCodeAction('layout-ambiguity')).toBe('该范围的原文阅读顺序需要核对，请查看对应 PDF 页面')
    expect(paperReviewGapCodeAction('empty-page')).toBe('该页没有可提取文字，可能为空白页或图片页，当前未进行 OCR')
    expect(paperReviewGapCodeAction('geometry-unavailable')).toBe('原文候选缺少可用的版面几何，无法定位内容')
    expect(paperReviewGapCodeAction('review-run-failed')).toBe('本次未能完成该单元的原文对照复检')
    expect(paperReviewGapCodeAction('inventory-run-failed')).toBe('本次原文分类未完成，可读正文仍保留供翻译，请核对后重新提交')
  })

  it('maps every source-classification code the backend emits', () => {
    expect(paperReviewGapCodeAction('invalid-classification', 'source')).toBe('模型清点结果不是有效的候选分类列表，已忽略')
    expect(paperReviewGapCodeAction('out-of-batch-candidate', 'source')).toBe('模型清点了本次批次之外的原文候选，已忽略')
    expect(paperReviewGapCodeAction('duplicate-candidate', 'source')).toBe('同一原文候选被重复清点，已弃用')
    expect(paperReviewGapCodeAction('classifier-omission', 'source')).toBe('模型漏清点了原文候选，以应用证据为准')
    expect(paperReviewGapCodeAction('classification-mismatch', 'source')).toBe('模型清点结果与应用证据不一致，以应用证据为准')
    expect(paperReviewGapCodeAction('invented-excluded', 'source')).toBe('模型无证据将正文标为排除，仍按可译正文保留')
    expect(paperReviewGapCodeAction('invented-preserved-original', 'source')).toBe('模型无证据将正文标为原文保留，仍按可译正文保留')
    expect(paperReviewGapCodeAction('invented-caption', 'source')).toBe('模型无证据将正文标为图注，仍按可译正文保留')
  })

  it('maps invalid-record by artifact: source classification vs translation entry', () => {
    expect(paperReviewGapCodeAction('invalid-record', 'source')).toBe('清点条目格式不正确，已忽略')
    expect(paperReviewGapCodeAction('invalid-record', 'translation')).toBe('译文条目格式不正确，已忽略')
    expect(paperReviewGapCodeAction('invalid-record')).toBe('条目格式不正确，已忽略')
  })

  it('falls back to a generic Chinese action for unknown codes (raw code stays in technical details)', () => {
    expect(paperReviewGapCodeAction('brand-new-code')).toBe('未能识别的缺口类型，详见技术细节')
    expect(paperReviewGapCodeAction('brand-new-code', 'source')).toBe('未能识别的缺口类型，详见技术细节')
  })
})

describe('paperReviewHumanGapGroups', () => {
  const units = [
    unit({ id: 'u-1', kind: 'heading', original: '1 Introduction' }),
    unit({ id: 'u-2', kind: 'paragraph', heading: '1 Introduction', spans: [span(2, 0)] }),
    unit({ id: 'u-3', kind: 'paragraph', heading: '2 Methods', spans: [span(3, 0)] }),
    unit({ id: 'u-4', kind: 'paragraph', heading: '2 Methods', spans: [span(4, 0)] }),
  ]

  it('aggregates same artifact+code gaps, collapsing contiguous pages and preserving headings and unit counts', () => {
    const groups = paperReviewHumanGapGroups([
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-2'], readerPages: [2], spans: [span(2, 0)], reason: 'translation: missing-translation',
      },
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-3'], readerPages: [3], spans: [span(3, 0)], reason: 'translation: missing-translation',
      },
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-4'], readerPages: [4], spans: [span(4, 0)], reason: 'translation: missing-translation',
      },
    ], units)

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group).toMatchObject({
      artifactLabel: '译文',
      code: 'missing-translation',
      action: '该单元没有返回译文',
      pageText: '第 2–4 页',
      headings: ['1 Introduction', '2 Methods'],
      unitCount: 3,
    })
  })

  it('keeps distinct artifact/code pairs as separate human lines in first-seen order', () => {
    const groups = paperReviewHumanGapGroups([
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-2'], readerPages: [2], spans: [span(2, 0)], reason: 'translation: missing-translation',
      },
      {
        artifact: 'source-review', code: 'review-issues', origin: 'model-review',
        unitIds: ['u-3'], readerPages: [3], spans: [span(3, 0)], reason: 'source-review: review-issues',
      },
    ], units)
    expect(groups.map((group) => `${group.artifactLabel}:${group.code}`)).toEqual([
      '译文:missing-translation',
      '核验:review-issues',
    ])
  })

  it('counts gaps without unit ids as zero-unit entries', () => {
    const groups = paperReviewHumanGapGroups([
      {
        artifact: 'translation', code: 'no-eligible-units', origin: 'application',
        unitIds: [], readerPages: [], spans: [], reason: 'PDF 范围内没有可翻译的正文段落、标题或图注。',
      },
    ], units)
    expect(groups[0]).toMatchObject({ action: '原文中没有可翻译的正文内容', unitCount: 0, pageText: '' })
  })

  it('counts unique units once across merged gaps of the same artifact+code', () => {
    const groups = paperReviewHumanGapGroups([
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-2', 'u-3'], readerPages: [2], spans: [span(2, 0)], reason: 'translation: missing-translation',
      },
      {
        artifact: 'translation', code: 'missing-translation', origin: 'application',
        unitIds: ['u-3', 'u-4'], readerPages: [3, 4], spans: [span(3, 0)], reason: 'translation: missing-translation',
      },
    ], units)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ unitCount: 3, pageText: '第 2–4 页', headings: ['1 Introduction', '2 Methods'] })
  })
})

describe('paperReviewReviewCounts / paperReviewReviewStatusLine', () => {
  it('counts passed and issues from the checks', () => {
    const review = { reviewOf: 'digest', status: 'incomplete', checks: [
      { unitId: 'u-1', verdict: 'passed' as const },
      { unitId: 'u-2', verdict: 'passed' as const },
      { unitId: 'u-3', verdict: 'issues' as const },
    ] }
    expect(paperReviewReviewCounts(review)).toEqual({ total: 3, passed: 2, issues: 1 })
  })

  it('writes a human status line with counts, never the fingerprint', () => {
    expect(paperReviewReviewStatusLine({ reviewOf: 'digest', status: 'passed', checks: [{ unitId: 'u-1', verdict: 'passed' }] }))
      .toBe('核验通过：1 / 1')
    expect(paperReviewReviewStatusLine({ reviewOf: 'digest', status: 'incomplete', checks: [
      { unitId: 'u-1', verdict: 'passed' }, { unitId: 'u-2', verdict: 'issues' },
    ] })).toBe('核验不完整：1 / 2 通过，1 项存在问题')
    expect(paperReviewReviewStatusLine({ reviewOf: 'digest', status: 'not-run', checks: [] }))
      .toBe('未核验：本次未进行原文对照复检')
  })
})

describe('paperReviewReviewCheckGroups', () => {
  const units = [
    unit({ id: 'u-1', kind: 'paragraph', heading: '1 Introduction', spans: [span(1, 0)] }),
    unit({ id: 'u-2', kind: 'paragraph', heading: '1 Introduction', spans: [span(1, 1)] }),
    unit({ id: 'u-3', kind: 'paragraph', heading: '2 Methods', spans: [span(2, 0)] }),
  ]

  it('groups verdicts by heading and page with unit counts', () => {
    const groups = paperReviewReviewCheckGroups({
      reviewOf: 'digest', status: 'incomplete',
      checks: [
        { unitId: 'u-1', verdict: 'passed' },
        { unitId: 'u-2', verdict: 'passed' },
        { unitId: 'u-3', verdict: 'issues' },
      ],
    }, units)
    expect(groups).toEqual([
      { verdict: 'passed', verdictLabel: '通过', heading: '1 Introduction', page: 1, unitCount: 2 },
      { verdict: 'issues', verdictLabel: '存在问题', heading: '2 Methods', page: 2, unitCount: 1 },
    ])
  })

  it('falls back to an unlabeled heading for units without a section heading', () => {
    const groups = paperReviewReviewCheckGroups({
      reviewOf: 'digest', status: 'incomplete',
      checks: [{ unitId: 'u-1', verdict: 'passed' }],
    }, [unit({ id: 'u-1', kind: 'paragraph', heading: '   ' })])
    expect(groups[0]?.heading).toBe('未归类段落')
  })
})
