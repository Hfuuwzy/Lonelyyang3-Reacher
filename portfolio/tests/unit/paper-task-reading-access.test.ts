/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPaperTaskReading } from '../../server/paper-task/reading-access'
import type { StoredSource } from '../../server/paper-task/source-store'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const REPORT = '# 深读报告\n\n## 主要发现\n\n论文报告了一项结果。\n\n![表1](asset:asset-abc)'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('deep-reading report retrieval', () => {
  it('returns the verified report with only referenced original assets', () => {
    const root = fixture()
    expect(readPaperTaskReading(TASK_ID, root, storedSource())).toEqual({
      taskId: TASK_ID,
      status: 'preview',
      markdown: REPORT,
      assets: [{ id: 'asset-abc', kind: 'table', caption: 'Table 1. Outcomes', availability: 'available' }],
    })
  })

  it('keeps a needs-confirmation report readable and honest', () => {
    const root = fixture({ status: 'needs-confirmation' })
    expect(readPaperTaskReading(TASK_ID, root, storedSource())).toMatchObject({
      status: 'needs-confirmation',
      markdown: REPORT,
    })
  })

  it('refuses a report whose bytes do not match its evidence record', () => {
    const root = fixture({ manuscriptSha256: '0'.repeat(64) })
    expect(readPaperTaskReading(TASK_ID, root, storedSource())).toBeUndefined()
  })

  it('refuses a report that no longer matches its retained preview mirror', () => {
    const root = fixture({ preview: '# 另一份报告' })
    expect(readPaperTaskReading(TASK_ID, root, storedSource())).toBeUndefined()
  })

  it('returns undefined when no coherent report was retained', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-reading-'))
    roots.push(root)
    expect(readPaperTaskReading(TASK_ID, root, storedSource())).toBeUndefined()
  })
})

function storedSource(): StoredSource {
  const record = (id: string, order: number, kind: 'heading' | 'body' | 'table', text: string) => ({
    id,
    order,
    kind,
    text,
    state: 'present' as const,
    page: 1,
    bbox: [0, 0, 10, 10] as const,
    sectionId: null,
    context: '',
    links: [],
    revision: 1,
  })
  return {
    source: {
      status: 'complete',
      pageCount: 1,
      records: [
        record('p1-r1', 1, 'heading', '主要发现'),
        record('p1-r2', 2, 'body', '论文报告了一项结果。'),
        record('p1-r3', 3, 'table', 'Table 1. Outcomes\nCondition A'),
      ],
    },
    revision: 1,
    assets: [
      {
        id: 'asset-abc',
        recordId: 'p1-r3',
        page: 1,
        bbox: [0, 0, 10, 10],
        availability: 'available',
        understanding: 'unverified',
      },
      {
        id: 'asset-unused',
        recordId: 'p1-r3',
        page: 1,
        bbox: [0, 0, 10, 10],
        availability: 'available',
        understanding: 'unverified',
      },
    ],
  }
}

function fixture(overrides: {
  readonly status?: 'preview' | 'needs-confirmation'
  readonly manuscriptSha256?: string
  readonly preview?: string
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-reading-'))
  roots.push(root)
  const directory = join(root, 'drafts', 'deep-reading')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'report.md'), REPORT)
  writeFileSync(join(directory, 'preview.md'), overrides.preview ?? REPORT)
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify({
    manuscriptSha256: overrides.manuscriptSha256 ?? createHash('sha256').update(REPORT).digest('hex'),
    status: overrides.status ?? 'preview',
    claims: [],
    assets: [],
    uncompletedReasons: [],
    unresolvedRecordIds: [],
    unverifiedAssetIds: [],
  }))
  return root
}
