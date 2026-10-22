import { describe, expect, it } from 'vitest'
import { isTranslationEligible, type PaperSourceSpan, type PaperSourceUnit } from '../../app/utils/paper-review-task-contract'
import { isPaperReviewTaskResult } from '../../app/utils/paper-review-contract'
import {
  paperSourceInventorySchema,
  paperSourceSpanSchema,
  paperSourceUnitSchema,
} from '../../app/utils/paper-review-task-schema'

const span = (overrides: Partial<PaperSourceSpan> = {}): PaperSourceSpan => ({
  readerPage: 1, lineIndex: 0, start: 0, end: 5, ...overrides,
})

interface UnitFields {
  readonly spans?: readonly PaperSourceSpan[]
  readonly mediaReaderPages?: readonly number[]
  readonly reason?: 'bibliography' | 'appendix' | 'formula' | 'table-content' | 'page-number'
  readonly headingAnchor?: PaperSourceSpan
  readonly tagged?: string
}

function assertNever(value: never): never {
  throw new Error(`Unexpected source unit kind: ${String(value)}`)
}

function unit(kind: PaperSourceUnit['kind'], fields: UnitFields = {}): PaperSourceUnit {
  const base = { id: 'u-1', spans: fields.spans ?? [span()], original: 'abc', heading: '' }
  const extra = fields.tagged === undefined ? {} : { tagged: fields.tagged }
  switch (kind) {
    case 'caption':
      return { ...base, ...extra, kind, mediaReaderPages: fields.mediaReaderPages ?? [1] }
    case 'excluded':
      return {
        ...base,
        ...extra,
        kind,
        reason: fields.reason === 'appendix' ? 'appendix' : 'bibliography',
        headingAnchor: fields.headingAnchor ?? span(),
      }
    case 'preserved-original':
      return {
        ...base,
        ...extra,
        kind,
        reason: fields.reason === 'table-content' || fields.reason === 'page-number' ? fields.reason : 'formula',
      }
    case 'paragraph':
    case 'heading':
    case 'unresolved':
      return { ...base, ...extra, kind }
    default:
      return assertNever(kind)
  }
}

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'incomplete',
    provider: 'provider',
    model: 'model',
    source: { sourceId: 's', pageCount: 1, units: [unit('paragraph')] },
    report: {
      sections: [{ kind: 'claims', title: 't', findings: [{ statement: 's', source: { heading: 'h', readerPage: 1, quote: 'q' } }] }],
      gaps: [],
    },
    translation: { pairs: [{ unitId: 'u-1', chinese: '译文' }], review: { reviewOf: 'r', status: 'passed', checks: [{ unitId: 'u-1', verdict: 'passed' }] } },
    gaps: [],
    ...overrides,
  }
}

function complete(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return result({ status: 'complete', ...overrides })
}

describe('paper-review result schema boundary', () => {
  it('rejects an empty span (end equals start)', () => {
    expect(paperSourceSpanSchema.safeParse(span({ start: 5, end: 5 })).success).toBe(false)
  })

  it('rejects a reversed span (end below start)', () => {
    expect(paperSourceSpanSchema.safeParse(span({ start: 4, end: 2 })).success).toBe(false)
  })

  it('rejects a zero-based reader page in a span', () => {
    expect(paperSourceSpanSchema.safeParse(span({ readerPage: 0 })).success).toBe(false)
  })

  it('rejects span and caption and anchor coordinates beyond the page count', () => {
    const outSpan = { sourceId: 's', pageCount: 1, units: [unit('paragraph', { spans: [span({ readerPage: 2 })] })] }
    expect(paperSourceInventorySchema.safeParse(outSpan).success).toBe(false)

    const outCaption = { sourceId: 's', pageCount: 1, units: [unit('caption', { mediaReaderPages: [2] })] }
    expect(paperSourceInventorySchema.safeParse(outCaption).success).toBe(false)

    const outAnchor = { sourceId: 's', pageCount: 1, units: [unit('excluded', { headingAnchor: span({ readerPage: 2 }) })] }
    expect(paperSourceInventorySchema.safeParse(outAnchor).success).toBe(false)
  })

  it('rejects an unknown source-unit kind', () => {
    expect(paperSourceUnitSchema.safeParse({ ...unit('paragraph'), kind: 'mystery' }).success).toBe(false)
  })

  it('accepts a null translation value and a null report', () => {
    const nullPair = result({ translation: { pairs: [{ unitId: 'u-1', chinese: null }], review: { reviewOf: 'r', status: 'passed', checks: [] } } })
    expect(isPaperReviewTaskResult(nullPair)).toBe(true)

    expect(isPaperReviewTaskResult(result({ report: null }))).toBe(true)
  })

  it('preserves arbitrary extra fields (accepted, not stripped)', () => {
    const withExtras = result({
      markedResult: true,
      provider: 'p',
      source: { sourceId: 's', pageCount: 1, units: [unit('paragraph', { tagged: 'x' })] },
    })
    expect(isPaperReviewTaskResult(withExtras)).toBe(true)

    const unitParsed = paperSourceUnitSchema.safeParse(unit('paragraph', { tagged: 'x' }))
    expect(unitParsed.success).toBe(true)
    if (unitParsed.success) {
      expect(unitParsed.data).toMatchObject({ tagged: 'x' })
    }
  })

  it('rejects a malformed nested report section via the existing #27 guard', () => {
    expect(isPaperReviewTaskResult(result({
      report: { sections: [{ kind: 'invented', title: 't', findings: [] }], gaps: [] },
    }))).toBe(false)
  })

  it('rejects a malformed nested report gap via the existing #27 guard', () => {
    expect(isPaperReviewTaskResult(result({
      report: { sections: [], gaps: [{ section: 's', reason: 42 }] },
    }))).toBe(false)
  })

  it('rejects a result missing any required task field', () => {
    const missingProvider = { ...result() }
    delete missingProvider.provider
    expect(isPaperReviewTaskResult(missingProvider)).toBe(false)
  })

  it('accepts a valid complete dossier', () => {
    expect(isPaperReviewTaskResult(complete())).toBe(true)
  })

  it.each([0, -1, 1.5, 2])('rejects report finding readerPage %s for either status', (readerPage) => {
    const invalidCitation = {
      report: {
        sections: [{ kind: 'claims', title: 't', findings: [{ statement: 's', source: { heading: 'h', readerPage, quote: 'q' } }] }],
        gaps: [],
      },
    }
    expect(isPaperReviewTaskResult(result(invalidCitation))).toBe(false)
    expect(isPaperReviewTaskResult(complete(invalidCitation))).toBe(false)
  })

  it('rejects a complete result with a null report', () => {
    expect(isPaperReviewTaskResult(complete({ report: null }))).toBe(false)
  })

  it('rejects a complete result carrying report or task gaps', () => {
    const reportGap = { report: { sections: [], gaps: [{ section: 's', reason: 'r' }] } }
    expect(isPaperReviewTaskResult(complete(reportGap))).toBe(false)
    const taskGap = { gaps: [{ artifact: 'translation', code: 'c', origin: 'application', unitIds: [], readerPages: [], spans: [], reason: 'r' }] }
    expect(isPaperReviewTaskResult(complete(taskGap))).toBe(false)
  })

  it('rejects a complete result with no eligible source units', () => {
    expect(isPaperReviewTaskResult(complete({ source: { sourceId: 's', pageCount: 1, units: [unit('excluded')] } }))).toBe(false)
  })

  it('rejects a complete result with unresolved or duplicate source units', () => {
    expect(isPaperReviewTaskResult(complete({ source: { sourceId: 's', pageCount: 1, units: [unit('paragraph'), unit('unresolved')] } }))).toBe(false)
    const dupIds = { source: { sourceId: 's', pageCount: 1, units: [{ ...unit('paragraph'), id: 'u-1' }, { ...unit('heading'), id: 'u-1' }] } }
    expect(isPaperReviewTaskResult(complete(dupIds))).toBe(false)
  })

  it.each([
    ['blank', [{ unitId: 'u-1', chinese: '' }]],
    ['missing', []],
    ['duplicate', [{ unitId: 'u-1', chinese: 'a' }, { unitId: 'u-1', chinese: 'b' }]],
    ['ineligible', [{ unitId: 'u-1', chinese: 'a' }, { unitId: 'u-9', chinese: 'b' }]],
  ] as const)('rejects a complete result with a %s translation pair', (_label, pairs) => {
    expect(isPaperReviewTaskResult(complete({ translation: { pairs, review: { reviewOf: 'r', status: 'passed', checks: [{ unitId: 'u-1', verdict: 'passed' }] } } }))).toBe(false)
  })

  it.each([
    ['non-passed status', 'incomplete', [{ unitId: 'u-1', verdict: 'passed' }]],
    ['failed verdict', 'passed', [{ unitId: 'u-1', verdict: 'issues' }]],
    ['missing check', 'passed', []],
    ['duplicate check', 'passed', [{ unitId: 'u-1', verdict: 'passed' }, { unitId: 'u-1', verdict: 'passed' }]],
    ['extra check', 'passed', [{ unitId: 'u-1', verdict: 'passed' }, { unitId: 'u-9', verdict: 'passed' }]],
  ] as const)('rejects a complete result with a %s review', (_label, status, checks) => {
    expect(isPaperReviewTaskResult(complete({ translation: { pairs: [{ unitId: 'u-1', chinese: '译文' }], review: { reviewOf: 'r', status, checks } } }))).toBe(false)
  })
})

describe('isTranslationEligible', () => {
  it.each([
    ['paragraph', true],
    ['heading', true],
    ['caption', true],
    ['excluded', false],
    ['preserved-original', false],
    ['unresolved', false],
  ] as const)('returns %s for a %s unit', (kind, eligible) => {
    expect(isTranslationEligible(unit(kind))).toBe(eligible)
  })
})
