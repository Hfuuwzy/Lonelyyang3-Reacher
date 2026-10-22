import { describe, expect, it } from 'vitest'
import {
  paperReviewGapItems,
  paperReviewGapScopeLabel,
  paperReviewHeadingLabel,
  PAPER_REVIEW_UNKNOWN_HEADING_LABEL,
} from '../../app/components/prototype/paper-review-labels'
import type { PaperReviewGap } from '../../app/utils/paper-review-contract'

function gap(section: string, reason: string): PaperReviewGap {
  return { section, reason }
}

describe('paperReviewGapScopeLabel', () => {
  it.each([
    ['claims', '论断'],
    ['Claims', '论断'],
    ['CLAIMS', '论断'],
    ['methods', '方法'],
    ['Methods', '方法'],
    ['experiments', '实验'],
    ['Experiments', '实验'],
    ['evidence', '证据'],
    ['Evidence', '证据'],
    ['criticism', '批评'],
    ['Criticism', '批评'],
    ['PDF source', 'PDF 原文'],
    ['pdf source', 'PDF 原文'],
    ['overall', '整体'],
    ['Overall', '整体'],
    ['full-translation', '全文翻译'],
    ['Full-Translation', '全文翻译'],
  ])('maps known scope alias %s to %s', (scope, label) => {
    // Given a scope string from the report wire.
    // When the display label is computed.
    const result = paperReviewGapScopeLabel(scope)
    // Then the known alias resolves to its Chinese label.
    expect(result).toBe(label)
  })

  it('preserves an unknown scope verbatim', () => {
    // Given a scope not present in the known alias table.
    // When the display label is computed.
    const result = paperReviewGapScopeLabel('Appendix')
    // Then the scope is shown exactly as reported.
    expect(result).toBe('Appendix')
  })
})

describe('paperReviewGapItems', () => {
  it('groups gaps with an identical reason into one item listing each affected scope', () => {
    // Given three gaps sharing one reason across three scopes.
    const gaps = [
      gap('Claims', '该章节没有提供任何论断，本次未覆盖。'),
      gap('Methods', '该章节没有提供任何论断，本次未覆盖。'),
      gap('Evidence', '该章节没有提供任何论断，本次未覆盖。'),
    ]
    // When the gaps are grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then one item carries the shared reason with every affected scope.
    expect(items).toEqual([
      { reason: '该章节没有提供任何论断，本次未覆盖。', scopes: ['论断', '方法', '证据'] },
    ])
  })

  it('deduplicates an identical reason/scope pair', () => {
    // Given the same reason repeated for the same scope.
    const gaps = [gap('Claims', '同因'), gap('Claims', '同因')]
    // When grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then the scope is listed once, not twice.
    expect(items).toEqual([{ reason: '同因', scopes: ['论断'] }])
  })

  it('collapses case variants of one known scope within the same reason', () => {
    // Given `claims` and `Claims` sharing one reason.
    const gaps = [gap('claims', '同因'), gap('Claims', '同因')]
    // When grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then both aliases render as one scope label.
    expect(items).toEqual([{ reason: '同因', scopes: ['论断'] }])
  })

  it('preserves an arbitrary model reason verbatim', () => {
    // Given a model-reported gap outside the known reason set.
    const gaps = [gap('Appendix', 'The appendix text is outside this review.')]
    // When grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then the reason and the unknown scope are both shown verbatim.
    expect(items).toEqual([{ reason: 'The appendix text is outside this review.', scopes: ['Appendix'] }])
  })

  it('keeps distinct reasons as separate items even for the same scope', () => {
    // Given two different reasons for one scope.
    const gaps = [gap('Claims', '原因甲'), gap('Claims', '原因乙')]
    // When grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then each reason is its own item in first-seen order.
    expect(items).toEqual([
      { reason: '原因甲', scopes: ['论断'] },
      { reason: '原因乙', scopes: ['论断'] },
    ])
  })

  it('keeps the first-seen order of both items and scopes', () => {
    // Given gaps whose reasons and scopes arrive in a non-sorted order.
    const gaps = [
      gap('Evidence', 'R2'),
      gap('Claims', 'R1'),
      gap('Methods', 'R1'),
      gap('Evidence', 'R2'),
      gap('Criticism', 'R2'),
    ]
    // When grouped for display.
    const items = paperReviewGapItems(gaps)
    // Then items follow the first occurrence of each reason and scopes their first occurrence.
    expect(items).toEqual([
      { reason: 'R2', scopes: ['证据', '批评'] },
      { reason: 'R1', scopes: ['论断', '方法'] },
    ])
  })

  it('returns an empty list for a report with no gaps', () => {
    // Given a report with no gaps.
    // When grouped for display.
    const items = paperReviewGapItems([])
    // Then no items are emitted.
    expect(items).toEqual([])
  })
})

describe('paperReviewHeadingLabel', () => {
  it('shows a localized fallback when the heading is empty', () => {
    // Given a finding whose source heading is empty.
    // When the heading label is computed.
    const result = paperReviewHeadingLabel('')
    // Then the fallback is shown instead of a blank source line.
    expect(result).toBe(PAPER_REVIEW_UNKNOWN_HEADING_LABEL)
  })

  it('shows the fallback for a whitespace-only heading', () => {
    expect(paperReviewHeadingLabel('   ')).toBe(PAPER_REVIEW_UNKNOWN_HEADING_LABEL)
  })

  it('preserves a real heading verbatim', () => {
    // Given a finding with a genuine chapter heading.
    // When the heading label is computed.
    const result = paperReviewHeadingLabel('1 Introduction')
    // Then the heading is shown exactly as reported.
    expect(result).toBe('1 Introduction')
  })
})
