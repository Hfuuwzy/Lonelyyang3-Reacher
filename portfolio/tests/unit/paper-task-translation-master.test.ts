/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { validateTranslationMaster } from '../../server/paper-task/translation-master.mjs'

const RECORDS = [
  stored('p1-r0', 'heading', '1 Introduction'),
  stored('p1-r1', 'body', 'The sample improved scores by 47.5% in 12 schools.'),
  stored('p2-r2', 'appendix', 'Appendix A. Additional results'),
  stored('p2-r3', 'footnote', '1 Funding note.'),
  stored('p2-r4', 'reference', 'Smith, J. (2020). A study of learning.'),
  stored('p2-r7', 'figure', 'Figure 1. Trend by group'),
  stored('p3-r5', 'table', 'Table 1. Outcomes by group'),
  stored('p4-r6', 'gap', '', 'unrecovered'),
]
const INDEX = RECORDS.map((entry) => entry.record.id)
const STATE = {
  status: 'complete',
  revision: 1,
  assets: [{ id: 'asset-abc', recordId: 'p3-r5', availability: 'available', understanding: 'unverified', relativePath: '../../assets/asset-abc.png' }],
}

const VALID_SEGMENTS = [
  { markdown: '# 1 引言\n\n样本使12所学校的成绩提高了47.5%。', source_record_ids: ['p1-r0', 'p1-r1'] },
  { markdown: '## 附录 A 补充结果\n\n作者给出补充结果。', source_record_ids: ['p2-r2'] },
  { markdown: '脚注：资助说明。', source_record_ids: ['p2-r3'] },
  { markdown: '## 参考文献\n\nSmith, J. (2020). A study of learning.', source_record_ids: ['p2-r4'] },
  { markdown: '图1：各组趋势。', source_record_ids: ['p2-r7'] },
  { markdown: '表1：各组结果\n\n![表1 各组结果](asset:asset-abc)', source_record_ids: ['p3-r5'] },
  { markdown: '待补：第4页原文无法恢复。', source_record_ids: [] },
]
const UNRESOLVED = [{ record_id: 'p4-r6', reason: '该页无可恢复文字。' }]
const TERMINOLOGY = [{ source: 'sample', target: '样本' }]

describe('translation master validation', () => {
  it('accepts a natural multi-record master with appendices, footnotes, references, and an original table asset', () => {
    const result = validateTranslationMaster(
      { segments: VALID_SEGMENTS, terminology: TERMINOLOGY, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )
    expect(result.markdown).toContain('## 附录 A 补充结果')
    expect(result.markdown).toContain('脚注：资助说明。')
    expect(result.markdown).toContain('图1：各组趋势。')
    expect(result.markdown).toContain('Smith, J. (2020). A study of learning.')
    const order = ['# 1 引言', '## 附录 A 补充结果', '脚注：资助说明。', '## 参考文献', '图1：各组趋势。', '表1：各组结果']
    for (let index = 0; index < order.length - 1; index += 1) {
      expect(result.markdown.indexOf(order[index] ?? '')).toBeLessThan(result.markdown.indexOf(order[index + 1] ?? ''))
    }
    expect(result.metadata.status).toBe('incomplete')
    expect(result.metadata.assets).toEqual([
      { id: 'asset-abc', recordId: 'p3-r5', kind: 'table', caption: 'Table 1. Outcomes by group', availability: 'available' },
    ])
    expect(result.metadata.unresolved).toEqual([{ recordId: 'p4-r6', reason: '该页无可恢复文字。' }])
    expect(result.metadata.segments[0]?.dependencies).toEqual([
      { recordId: 'p1-r0', revision: 1 },
      { recordId: 'p1-r1', revision: 1 },
    ])
  })

  it('rejects an indexed record that is neither translated nor marked unresolved', () => {
    const records = RECORDS.slice(0, 3)
    const index = records.map((entry) => entry.record.id)
    expect(() => validateTranslationMaster(
      { segments: [VALID_SEGMENTS[0]] },
      { records, state: { ...STATE, assets: [] }, indexIds: index, sourceRevision: 1 },
    )).toThrow('every indexed source record')
  })

  it('rejects a master that drops or changes a source number or unit', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p1-r1')
      ? { ...segment, markdown: segment.markdown.replace('47.5%', '48%') }
      : segment)
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('source number or unit')
  })

  it('requires every available visual record to be kept as a referenced original asset', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p3-r5')
      ? { ...segment, markdown: '表1：各组结果\n\n| 组 | 结果 |' }
      : segment)
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('original asset')
  })

  it('rejects images outside the controlled task asset scheme', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p3-r5')
      ? { ...segment, markdown: '表1：各组结果\n\n![表1](https://example.com/table.png)' }
      : segment)
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('controlled original assets')
  })

  it('rejects a reference entry that was not preserved in English', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p2-r4')
      ? { ...segment, markdown: '## 参考文献\n\n史密斯，2020，学习研究。' }
      : segment)
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('original English text')
  })

  it('rejects unresolved material without a reader-visible disclosure', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.markdown === '待补：第4页原文无法恢复。'
      ? { ...segment, markdown: '' }
      : segment).filter((segment) => segment.markdown !== '')
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('disclose what needs confirmation')
  })

  it('rejects terminology that is absent from the master or duplicated', () => {
    expect(() => validateTranslationMaster(
      { segments: VALID_SEGMENTS, terminology: [{ source: 'sample', target: '样例' }], unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('terminology')
    expect(() => validateTranslationMaster(
      { segments: VALID_SEGMENTS, terminology: [...TERMINOLOGY, ...TERMINOLOGY], unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('terminology')
  })

  it('accounts for more than the former 200-record dependency cap', () => {
    const records = Array.from({ length: 205 }, (_, index) => stored(`p1-r${index}`, 'body', `Evidence ${index}.`))
    const ids = records.map((entry) => entry.record.id)
    const segments = []
    for (let start = 0; start < ids.length; start += 60) {
      const batch = ids.slice(start, start + 60)
      segments.push({ markdown: batch.map((id) => `记录${id.slice(4)}。`).join('\n\n'), source_record_ids: batch })
    }
    const result = validateTranslationMaster(
      { segments },
      { records, state: { status: 'complete', revision: 1, assets: [] }, indexIds: ids, sourceRevision: 1 },
    )
    expect(result.metadata.segments).toHaveLength(4)
    expect(result.metadata.status).toBe('complete')
  })

  it('derives an asset dependency from the referenced original asset', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p3-r5')
      ? { ...segment, source_record_ids: [] }
      : segment)
    const result = validateTranslationMaster(
      { segments, terminology: TERMINOLOGY, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )
    expect(result.metadata.segments[5]?.dependencies).toEqual([{ recordId: 'p3-r5', revision: 1 }])
  })

  it('does not count an asset reference inside a code fence as preserved', () => {
    const segments = VALID_SEGMENTS.map((segment) => segment.source_record_ids.includes('p3-r5')
      ? { ...segment, markdown: '表1：各组结果\n\n```\n![表1](asset:asset-abc)\n```' }
      : segment)
    expect(() => validateTranslationMaster(
      { segments, unresolved: UNRESOLVED },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('original asset')
  })

  it('requires a retained figure asset to be referenced', () => {
    const state = { ...STATE, assets: [...STATE.assets, { id: 'asset-fig', recordId: 'p2-r7', availability: 'available', understanding: 'unverified', relativePath: '../../assets/asset-fig.png' }] }
    expect(() => validateTranslationMaster(
      { segments: VALID_SEGMENTS, unresolved: UNRESOLVED },
      { records: RECORDS, state, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('retained figure')
  })

  it('rejects a master that changes a bounded number even when its digits appear elsewhere', () => {
    const records = [stored('p1-r0', 'body', 'The dose was 5 kg.')]
    expect(() => validateTranslationMaster(
      { segments: [{ markdown: '剂量为15 mg。', source_record_ids: ['p1-r0'] }] },
      { records, state: { status: 'complete', revision: 1, assets: [] }, indexIds: ['p1-r0'], sourceRevision: 1 },
    )).toThrow('source number or unit')
  })

  it('rejects a short summary that lists every record but does not carry the source text', () => {
    const records = [stored('p1-r0', 'body', `The study reports a detailed result. ${'Additional context. '.repeat(40)}`)]
    expect(() => validateTranslationMaster(
      { segments: [{ markdown: '论文报告了一项结果。', source_record_ids: ['p1-r0'] }] },
      { records, state: { status: 'complete', revision: 1, assets: [] }, indexIds: ['p1-r0'], sourceRevision: 1 },
    )).toThrow('too short')
  })

  it('rejects translating an ambiguous record instead of declaring it unresolved', () => {
    const records = [stored('p1-r0', 'body', 'Ambiguous source line.', 'ambiguous')]
    expect(() => validateTranslationMaster(
      { segments: [{ markdown: '模糊的译文。', source_record_ids: ['p1-r0'] }] },
      { records, state: { status: 'needs-confirmation', revision: 1, assets: [] }, indexIds: ['p1-r0'], sourceRevision: 1 },
    )).toThrow('ambiguous or missing')
  })

  it('rejects translating an unrecoverable gap instead of declaring it unresolved', () => {
    const segments = [...VALID_SEGMENTS, { markdown: '猜测的缺失段落。', source_record_ids: ['p4-r6'] }]
    expect(() => validateTranslationMaster(
      { segments, unresolved: [] },
      { records: RECORDS, state: STATE, indexIds: INDEX, sourceRevision: 1 },
    )).toThrow('unrecoverable source records cannot be translated')
  })
})

function stored(id: string, kind: string, text: string, state = 'present') {
  return {
    record: { id, kind, text, state, order: Number(id.slice(4)), page: Number(id.slice(1, 2)), bbox: [0, 0, 1, 1], sectionId: null, context: '', links: [] },
    revision: 1,
  }
}
