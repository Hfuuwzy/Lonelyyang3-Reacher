/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPaperTaskTranslation } from '../../server/paper-task/translation-access'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('translation master retrieval', () => {
  it('returns the complete master with referenced original assets and status', () => {
    const root = fixture()
    expect(readPaperTaskTranslation(TASK_ID, root)).toEqual({
      taskId: TASK_ID,
      status: 'complete',
      markdown: '# 主稿\n\n原文段落的自然译文。\n\n![表1](asset:asset-abc)',
      assets: [{ id: 'asset-abc', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
      unresolved: [],
      staleParagraphs: [],
    })
  })

  it('excludes a coherent old artifact when its present source prose is replaced by a placeholder', () => {
    const root = fixture({ placeholder: true })
    expect(readPaperTaskTranslation(TASK_ID, root)).toBeUndefined()
  })

  it('reports stale paragraphs after a source correction without rewriting the master', () => {
    const root = fixture({ stale: true })
    expect(readPaperTaskTranslation(TASK_ID, root)).toMatchObject({
      status: 'needs-update',
      staleParagraphs: [0],
      markdown: '# 主稿\n\n原文段落的自然译文。\n\n![表1](asset:asset-abc)',
    })
  })

  it('refuses a master whose bytes do not match its retained ledger', () => {
    const root = fixture({ masterSha256: '0'.repeat(64) })
    expect(readPaperTaskTranslation(TASK_ID, root)).toBeUndefined()
  })

  it('refuses a short master even when its hash was updated but its eligible segments were not', () => {
    const root = fixture({ manuscript: '测试段' })
    expect(readPaperTaskTranslation(TASK_ID, root)).toBeUndefined()
  })

  it('returns undefined when no coherent master was retained', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-translation-'))
    roots.push(root)
    expect(readPaperTaskTranslation(TASK_ID, root)).toBeUndefined()
  })
})

function fixture(overrides: { readonly stale?: boolean; readonly masterSha256?: string; readonly placeholder?: boolean; readonly manuscript?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-translation-'))
  roots.push(root)
  const directory = join(root, 'drafts', 'translation')
  mkdirSync(directory, { recursive: true })
  const markdown = overrides.manuscript ?? (overrides.placeholder === true
    ? '测试段'
    : '# 主稿\n\n原文段落的自然译文。\n\n![表1](asset:asset-abc)')
  writeFileSync(join(directory, 'master.md'), markdown)
  writeFileSync(join(directory, 'translation.json'), JSON.stringify({
    version: 1,
    status: 'complete',
    sourceRevision: overrides.stale === true ? 2 : 1,
    masterSha256: overrides.masterSha256 ?? createHash('sha256').update(markdown).digest('hex'),
    segments: overrides.placeholder === true
      ? [{ index: 0, markdown: '测试段', stale: false, dependencies: [{ recordId: 'p1-r1', revision: 1 }] }]
      : [
          { index: 0, markdown: '# 主稿\n\n原文段落的自然译文。', stale: overrides.stale === true, dependencies: [{ recordId: 'p1-r1', revision: 1 }] },
          { index: 1, markdown: '![表1](asset:asset-abc)', stale: false, dependencies: [{ recordId: 'p1-r2', revision: 1 }] },
        ],
    terminology: [],
    unresolved: [],
    assets: [{ id: 'asset-abc', recordId: 'p1-r2', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
  }))
  mkdirSync(join(root, 'source-records'), { recursive: true })
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(['p1-r1', 'p1-r2']))
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete' }))
  writeFileSync(join(root, 'source-records', 'p1-r1.json'), JSON.stringify({
    record: {
      id: 'p1-r1', kind: 'body', state: 'present',
      text: overrides.placeholder === true ? `Original source prose. ${'Detailed results remain in the source. '.repeat(10)}` : '原文段落的自然译文。',
    }, revision: 1,
  }))
  writeFileSync(join(root, 'source-records', 'p1-r2.json'), JSON.stringify({
    record: { id: 'p1-r2', kind: 'table', state: 'present', text: 'Table 1. Outcomes' }, revision: 1,
  }))
  return root
}
