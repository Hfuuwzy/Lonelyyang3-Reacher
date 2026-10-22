import { describe, expect, it } from 'vitest'
import type {
  PaperReviewTaskResult,
  PaperSourceUnit,
} from '../../app/utils/paper-review-task-contract'
import {
  readerDossierTocLinks,
  readerDossierUnitViews,
} from '../../app/components/prototype/reader-dossier-views'

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

const PAGES: PaperReviewTaskResult = {
  status: 'complete',
  provider: 'fixture-provider',
  model: 'fixture-model',
  source: { sourceId: 'fixed-29', pageCount: 2, units: [] },
  report: { sections: [], gaps: [] },
  translation: { pairs: [], review: { reviewOf: 'u-2', status: 'passed', checks: [] } },
  gaps: [],
}

describe('readerDossierUnitViews', () => {
  it('keeps source order and attaches exact pairs to eligible units', () => {
    const units = [
      unit({ id: 'u-1', kind: 'heading', original: '1 Introduction' }),
      unit({ id: 'u-2', kind: 'paragraph', original: 'The calibrated system does not increase error.' }),
      unit({ id: 'u-3', kind: 'paragraph', original: 'A second paragraph.' }),
    ]
    const views = readerDossierUnitViews(units, [
      { unitId: 'u-1', chinese: '导言' },
      { unitId: 'u-2', chinese: '校准系统不会增加误差。' },
    ])
    expect(views.map((view) => view.unit.id)).toEqual(['u-1', 'u-2', 'u-3'])
    expect(views[0]).toMatchObject({ kindLabel: '标题', chinese: '导言', pairMissing: false })
    expect(views[1]).toMatchObject({ kindLabel: '段落', chinese: '校准系统不会增加误差。', pairMissing: false })
  })

  it('marks an explicit null translation and a missing pair as missing', () => {
    const units = [
      unit({ id: 'u-2', kind: 'paragraph' }),
      unit({ id: 'u-3', kind: 'paragraph' }),
    ]
    const views = readerDossierUnitViews(units, [
      { unitId: 'u-2', chinese: null },
    ])
    expect(views[0]?.pairMissing).toBe(true)
    expect(views[1]?.pairMissing).toBe(true)
    expect(views[1]?.chinese).toBeNull()
  })

  it('exposes the app-owned section heading as headingLabel when nonblank', () => {
    const views = readerDossierUnitViews([
      unit({ id: 'u-1', kind: 'paragraph', heading: ' 1 Introduction ' }),
      unit({ id: 'u-2', kind: 'paragraph', heading: '   ' }),
    ], [])
    expect(views[0]?.headingLabel).toBe('1 Introduction')
    expect(views[1]?.headingLabel).toBeNull()
  })

  it('never marks preserved/excluded/unresolved units as missing translations', () => {
    const units = [
      unit({ id: 'u-7', kind: 'preserved-original', reason: 'table-content', original: 'Method | Accuracy' }),
      unit({ id: 'u-9', kind: 'excluded', reason: 'bibliography', original: '[1] Example Author. 2024.' }),
      unit({ id: 'u-12', kind: 'unresolved', original: '? unknown ?' }),
    ]
    const views = readerDossierUnitViews(units, [])
    expect(views[0]?.pairMissing).toBe(false)
    expect(views[1]?.pairMissing).toBe(false)
    expect(views[2]?.pairMissing).toBe(false)
    expect(views[0]).toMatchObject({ kindLabel: '原文保留', detailLabel: '表格内容' })
    expect(views[1]).toMatchObject({ kindLabel: '排除', detailLabel: '参考文献' })
    expect(views[2]).toMatchObject({ kindLabel: '未解析', detailLabel: '未解析' })
  })

  it('exposes caption span pages (ignoring mediaReaderPages) and preserved span pages as pdfPages', () => {
    const caption = unit({
      id: 'u-5', kind: 'caption', mediaReaderPages: [9], spans: [span(2, 6)],
    })
    const preserved = unit({
      id: 'u-8', kind: 'preserved-original', reason: 'formula', original: 'E = m c^2',
      spans: [span(2, 6)],
    })
    const views = readerDossierUnitViews([caption, preserved], [])
    expect(views[0]?.pdfPages).toEqual([2])
    expect(views[1]?.pdfPages).toEqual([2])
  })

  it('assigns one inline preview per original page, first eligible unit in source order', () => {
    const units = [
      unit({ id: 'u-c1', kind: 'caption', mediaReaderPages: [9], spans: [span(2, 6)] }),
      unit({ id: 'u-p1', kind: 'preserved-original', reason: 'formula', spans: [span(2, 6)] }),
      unit({ id: 'u-c2', kind: 'caption', mediaReaderPages: [9], spans: [span(3, 0)] }),
      unit({ id: 'u-p2', kind: 'preserved-original', reason: 'table-content', spans: [span(3, 0)] }),
      unit({ id: 'u-p3', kind: 'preserved-original', reason: 'page-number', spans: [span(4, 0)] }),
      unit({ id: 'u-p4', kind: 'preserved-original', reason: 'formula', spans: [] }),
    ]
    const views = readerDossierUnitViews(units, [])
    expect(views.map((view) => view.previewPage)).toEqual([2, null, 3, null, null, null])
    expect(views[0]).toMatchObject({ unit: { id: 'u-c1' }, previewPage: 2 })
    expect(views[2]).toMatchObject({ unit: { id: 'u-c2' }, previewPage: 3 })
  })

  it('assigns no preview when an eligible unit has no page reference', () => {
    const views = readerDossierUnitViews([
      unit({ id: 'u-c', kind: 'caption', mediaReaderPages: [], spans: [] }),
    ], [])
    expect(views[0]?.previewPage).toBeNull()
  })

  it('uses caption span pages and never chases a misleading model media-page guess', () => {
    const caption = unit({
      id: 'u-c', kind: 'caption', mediaReaderPages: [3], spans: [span(2, 0), span(1, 4)],
    })
    const views = readerDossierUnitViews([caption], [])
    expect(views[0]?.pdfPages).toEqual([1, 2])
    expect(views[0]?.previewPage).toBe(1)
  })
})

describe('readerDossierTocLinks', () => {
  it('builds B-style chapter links from app data in stable order', () => {
    const result: PaperReviewTaskResult = {
      ...PAGES,
      source: {
        sourceId: 'fixed-29',
        pageCount: 2,
        units: [
          unit({ id: 'u-h1', kind: 'heading', original: '1 Introduction' }),
          unit({ id: 'u-9', kind: 'excluded', reason: 'bibliography' }),
        ],
      },
      gaps: [
        {
          artifact: 'translation', code: 'translation-missing', origin: 'application',
          unitIds: ['u-2'], readerPages: [1], spans: [span(1, 1)], reason: '缺译文',
        },
      ],
    }
    expect(readerDossierTocLinks(result)).toEqual([
      { id: 'dossier-report', text: '审阅报告' },
      { id: 'dossier-gaps', text: '未覆盖范围' },
      { id: 'dossier-translation', text: '译文对照' },
      { id: 'dossier-unit-u-h1', text: '1 Introduction' },
      { id: 'dossier-review', text: '核验状态' },
    ])
  })

  it('omits the gaps entry when there are no task gaps', () => {
    const links = readerDossierTocLinks({ ...PAGES, gaps: [] })
    expect(links.map((link) => link.text)).not.toContain('未覆盖范围')
    expect(links.map((link) => link.id)).toEqual(['dossier-report', 'dossier-translation', 'dossier-review'])
  })
})