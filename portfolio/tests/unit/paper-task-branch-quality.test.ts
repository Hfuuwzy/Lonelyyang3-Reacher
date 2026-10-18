/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateBranchQuality } from '../../server/paper-task/branch-quality'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174070'
const roots: string[] = []
const TABLE = 'asset-00000000000000000000000000000001'
const FIGURE = 'asset-00000000000000000000000000000002'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('branch quality evaluation', () => {
  it('marks a complete translation with a clean review as complete', () => {
    const fixture = translationFixture()
    expect(evaluateBranchQuality(fixture.root, 'translation')).toMatchObject({
      status: 'complete', reviewCompleted: true, options: [],
    })
  })

  it('marks a complete deep-reading report with grounded evidence as complete', () => {
    const fixture = deepReadingFixture()
    expect(evaluateBranchQuality(fixture.root, 'deep-reading')).toMatchObject({
      status: 'complete', reviewCompleted: true,
    })
  })

  it('marks a readable translation with a missing appendix or unavailable asset as needs-confirmation', () => {
    const fixture = translationFixture({ omitAppendix: true, unavailableFigure: true })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['missing-coverage', 'asset-unavailable']))
    expect(result.options).toContain('keep-readable')
  })

  it('marks a deep-reading result with missing source material as needs-confirmation', () => {
    const fixture = deepReadingFixture({ gap: true })
    const result = evaluateBranchQuality(fixture.root, 'deep-reading')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['uncompleted-material', 'unresolved-source']))
  })

  it('blocks a translation whose dependency-linked number changed', () => {
    const fixture = translationFixture({ number: '48%' })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('number-mismatch')
  })

  it('blocks deep reading whose evidence quote does not match the source', () => {
    const fixture = deepReadingFixture({ quote: 'fabricated quote' })
    const result = evaluateBranchQuality(fixture.root, 'deep-reading')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('claim-evidence-invalid')
  })

  it('never treats an unavailable crop as verified deep-reading evidence', () => {
    const fixture = deepReadingFixture({ unavailableAsset: true })
    const result = evaluateBranchQuality(fixture.root, 'deep-reading')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('asset-unavailable')
  })

  it('treats a review with only minor findings as acceptable', () => {
    const fixture = translationFixture({ reviewFindings: [finding('f1', 'layout', 'minor')] })
    expect(evaluateBranchQuality(fixture.root, 'translation').status).toBe('complete')
  })

  it('keeps a substantive review finding unresolved until the single repair covers it', () => {
    const unresolved = translationFixture({ reviewFindings: [finding('f1', 'number', 'substantive', [1], ['p1-r2'])] })
    expect(evaluateBranchQuality(unresolved.root, 'translation').status).toBe('needs-confirmation')
    const repaired = translationFixture({
      reviewFindings: [finding('f1', 'number', 'substantive', [1], ['p1-r2'])],
      repaired: true,
    })
    expect(evaluateBranchQuality(repaired.root, 'translation').status).toBe('complete')
  })

  it('keeps a partial repair in needs-confirmation', () => {
    const fixture = translationFixture({
      reviewFindings: [finding('f1', 'number', 'substantive', [1], ['p1-r2']), finding('f2', 'omission', 'substantive', [2], ['p1-r3'])],
      repaired: true,
      repairedFindings: ['f1'],
    })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('review-omission')
  })

  it('keeps a rejected repair in needs-confirmation instead of hiding residual findings', () => {
    const fixture = translationFixture({
      reviewFindings: [finding('f1', 'number', 'substantive', [1], ['p1-r2'])],
      repaired: true,
      repairedFindings: [],
      repairError: true,
    })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('review-number')
    expect(result.options).toContain('keep-readable')
  })

  it('blocks a corrupt retained crop even when its file exists', () => {
    const fixture = translationFixture({ corruptAsset: true })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('asset-damaged')
  })

  it('blocks a declared terminology choice that is absent from the master', () => {
    const fixture = translationFixture({ omitTerminologyTarget: true })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('needs-confirmation')
    expect(result.issues.map((issue) => issue.code)).toContain('terminology-missing')
  })

  it('reports preview when the single content review is missing', () => {
    const fixture = translationFixture({ review: false })
    const result = evaluateBranchQuality(fixture.root, 'translation')
    expect(result.status).toBe('preview')
    expect(result.issues.map((issue) => issue.code)).toContain('review-incomplete')
  })

  it('reports preview when the review describes stale bytes', () => {
    const fixture = translationFixture({ reviewSha: 'f'.repeat(64) })
    expect(evaluateBranchQuality(fixture.root, 'translation').status).toBe('preview')
  })

  it('reports failed when the retained master and ledger disagree', () => {
    const fixture = translationFixture({ masterSha: '0'.repeat(64) })
    expect(evaluateBranchQuality(fixture.root, 'translation').status).toBe('failed')
  })
})

type TranslationOptions = {
  readonly omitAppendix?: boolean
  readonly unavailableFigure?: boolean
  readonly number?: string
  readonly reviewFindings?: readonly ReturnType<typeof finding>[]
  readonly repaired?: boolean
  readonly repairedFindings?: readonly string[]
  readonly review?: boolean
  readonly reviewSha?: string
  readonly masterSha?: string
  readonly repairError?: boolean
  readonly corruptAsset?: boolean
  readonly omitTerminologyTarget?: boolean
}

function translationFixture(options: TranslationOptions = {}) {
  const root = makeRoot()
  const source = writeSource(root, { unavailableFigure: options.unavailableFigure, corruptAsset: options.corruptAsset })
  const number = options.number ?? '47.5%'
  const terminology = options.omitTerminologyTarget === true ? '样例' : '样本'
  const segments = [
    { markdown: `# 引言\n\n${terminology}使12所学校的成绩提高了${number}。`, deps: ['p1-r0', 'p1-r1'] },
    ...(options.omitAppendix === true ? [] : [{ markdown: '## 附录 A 补充结果\n\n作者给出补充结果。', deps: ['p1-r2'] }]),
    { markdown: '脚注：资助说明。', deps: ['p1-r3'] },
    { markdown: '## 参考文献\n\nSmith, J. (2020). A study of learning.', deps: ['p1-r4'] },
    { markdown: `图1：各组趋势。\n\n![图1 各组趋势](asset:${FIGURE})`, deps: ['p1-r5'] },
    { markdown: `表1：各组结果\n\n![表1 各组结果](asset:${TABLE})`, deps: ['p1-r6'] },
  ]
  const markdown = segments.map((segment) => segment.markdown).join('\n\n')
  const metadata = {
    version: 1,
    status: 'complete',
    sourceRevision: 1,
    masterSha256: options.masterSha ?? hash(markdown),
    segments: segments.map((segment, index) => ({
      index, markdown: segment.markdown, stale: false,
      dependencies: segment.deps.map((recordId) => ({ recordId, revision: 1 })),
    })),
    terminology: [{ source: 'sample', target: '样本' }],
    unresolved: [],
    assets: [
      { id: TABLE, recordId: 'p1-r6', kind: 'table', caption: 'Table 1. Outcomes by group', availability: 'available' },
      { id: FIGURE, recordId: 'p1-r5', kind: 'figure', caption: 'Figure 1. Trend by group', availability: 'available' },
    ],
  }
  const directory = join(root, 'drafts', 'translation')
  writeFileSync(join(directory, 'master.md'), markdown)
  writeFileSync(join(directory, 'preview.md'), markdown)
  writeFileSync(join(directory, 'translation.json'), JSON.stringify(metadata))
  if (options.review !== false) {
    writeReview(directory, 'translation', options.reviewSha ?? hash(markdown), options.reviewFindings ?? [], options)
  }
  return { root, source }
}

type DeepOptions = {
  readonly gap?: boolean
  readonly quote?: string
  readonly unavailableAsset?: boolean
  readonly reviewFindings?: readonly ReturnType<typeof finding>[]
  readonly repaired?: boolean
  readonly repairedFindings?: readonly string[]
  readonly review?: boolean
}

function deepReadingFixture(options: DeepOptions = {}) {
  const root = makeRoot()
  const source = writeSource(root, { gap: options.gap, unavailableAsset: options.unavailableAsset })
  const fact = '事实：第一学年干预组平均测验分数提高八个百分点。'
  const inference = '分析推论：该结果可能适用于相似样本。'
  const report = `# 干预研究\n\n${fact}\n\n${inference}`
  const evidence = {
    manuscriptSha256: hash(report),
    status: options.gap === true ? 'needs-confirmation' : 'preview',
    claims: [
      { passage: fact, kind: 'fact', explanation: null, evidence: [{ recordId: 'p1-r1', revision: 1, quote: options.quote ?? source.records[1].record.text }] },
      { passage: inference, kind: 'inference', explanation: '这是对报告结果的解释。', evidence: [{ recordId: 'p1-r1', revision: 1, quote: source.records[1].record.text }] },
    ],
    assets: [],
    uncompletedReasons: options.gap === true ? ['第二学年失访机制尚未核实。'] : [],
    unresolvedRecordIds: options.gap === true ? ['p2-r7'] : [],
    qualityIssues: [],
  }
  const directory = join(root, 'drafts', 'deep-reading')
  writeFileSync(join(directory, 'report.md'), report)
  writeFileSync(join(directory, 'preview.md'), report)
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence))
  if (options.review !== false) {
    writeReview(directory, 'deep-reading', hash(report), options.reviewFindings ?? [], options)
  }
  return { root, source }
}

function writeSource(root: string, options: { readonly unavailableFigure?: boolean; readonly unavailableAsset?: boolean; readonly corruptAsset?: boolean; readonly gap?: boolean } = {}) {
  const records = [
    stored('p1-r0', 'heading', '1 Introduction', 0),
    stored('p1-r1', 'body', 'The sample improved scores by 47.5% in 12 schools. 第一学年干预组平均测验分数提高八个百分点。', 1),
    stored('p1-r2', 'appendix', 'Appendix A. Additional results', 2),
    stored('p1-r3', 'footnote', '1 Funding note.', 3),
    stored('p1-r4', 'reference', 'Smith, J. (2020). A study of learning.', 4),
    stored('p1-r5', 'figure', 'Figure 1. Trend by group', 5),
    stored('p1-r6', 'table', 'Table 1. Outcomes by group', 6),
    ...(options.gap === true ? [stored('p2-r7', 'gap', '', 7, 'unrecovered')] : []),
  ]
  const directory = join(root, 'source-records')
  for (const entry of records) writeFileSync(join(directory, `${entry.record.id}.json`), JSON.stringify(entry))
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(records.map((entry) => entry.record.id)))
  const assets = [
    { id: TABLE, recordId: 'p1-r6', availability: options.unavailableAsset === true ? 'unavailable' : 'available', understanding: 'unverified', relativePath: options.unavailableAsset === true ? null : `../../assets/${TABLE}.png` },
    { id: FIGURE, recordId: 'p1-r5', availability: options.unavailableFigure === true ? 'unavailable' : 'available', understanding: 'unverified', relativePath: options.unavailableFigure === true ? null : `../../assets/${FIGURE}.png` },
  ]
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete', revision: 1, assets }))
  writeFileSync(join(root, 'assets', `${TABLE}.png`), options.corruptAsset === true ? Buffer.from('not-a-png') : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (options.unavailableFigure !== true) writeFileSync(join(root, 'assets', `${FIGURE}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return { records }
}

function writeReview(
  directory: string,
  branch: 'translation' | 'deep-reading',
  baselineSha256: string,
  findings: readonly ReturnType<typeof finding>[],
  options: { readonly repaired?: boolean; readonly repairedFindings?: readonly string[]; readonly repairError?: boolean },
): void {
  const substantive = findings.filter((entry) => entry.severity === 'substantive').map((entry) => entry.id)
  const applied = options.repaired === true ? (options.repairedFindings ?? substantive) : []
  const residual = substantive.filter((id) => !applied.includes(id))
  writeFileSync(join(directory, 'review.json'), JSON.stringify({
    version: 1,
    branch,
    baselineSha256,
    findings,
    repair: options.repaired === true
      ? {
          attempted: true, appliedFindingIds: [...applied], residualFindingIds: residual, changedTargets: [], repairedSha256: baselineSha256,
          ...(options.repairError === true ? { error: 'repair-rejected' } : {}),
        }
      : null,
  }))
}

function finding(id: string, code: string, severity: 'minor' | 'substantive', targetIndexes: readonly number[] = [], recordIds: readonly string[] = []) {
  return { id, code, severity, description: `${code} finding`, targetIndexes, recordIds }
}

function stored(id: string, kind: string, text: string, order: number, state = 'present') {
  return {
    record: { id, kind, text, state, order, page: Number(id.slice(1, 2)), bbox: [0, 0, 1, 1], sectionId: null, context: '', links: [] },
    revision: 1,
  }
}

function makeRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), 'paper-quality-'))
  roots.push(parent)
  const root = join(parent, TASK_ID)
  mkdirSync(join(root, 'source-records'), { recursive: true })
  mkdirSync(join(root, 'assets'), { recursive: true })
  mkdirSync(join(root, 'drafts', 'translation', 'pieces'), { recursive: true })
  mkdirSync(join(root, 'drafts', 'deep-reading', 'pieces'), { recursive: true })
  return root
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
