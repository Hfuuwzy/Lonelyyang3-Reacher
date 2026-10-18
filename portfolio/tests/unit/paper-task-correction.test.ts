/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import { createSampleProcessRuntimeFactory } from '../../server/paper-task/runtime'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import type { PaperTaskSelection } from '../../app/utils/paper-task-contract'

const ID = '123e4567-e89b-12d3-a456-426614174000'
const roots: string[] = []
const prepared: PaperTaskSourceResult = {
  success: true,
  source: {
    status: 'incomplete', pageCount: 2,
    records: [
      { id: 'p1-r0', order: 0, kind: 'heading', text: '1 Overview', state: 'present', page: 1, bbox: [0, 0, 1, 1], sectionId: 'p1-r0', context: '1 Overview', links: [] },
      { id: 'p1-r1', order: 1, kind: 'body', text: 'Body one 47.5%.', state: 'present', page: 1, bbox: [0, 2, 1, 1], sectionId: 'p1-r0', context: '1 Overview', links: [] },
      { id: 'p1-r2', order: 2, kind: 'body', text: 'Final body.', state: 'present', page: 1, bbox: [0, 4, 1, 1], sectionId: 'p1-r0', context: 'Body one 47.5%.', links: [] },
      { id: 'p2-r0', order: 3, kind: 'gap', text: '', state: 'unrecovered', page: 2, bbox: [0, 0, 612, 792], sectionId: 'p1-r0', context: 'No selectable text.', links: [] },
    ],
  },
  assets: [],
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function completedTask(selection: PaperTaskSelection = 'both') {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-correction-'))
  roots.push(root)
  const service = createPaperTaskService({ projectRoot: root, createId: () => ID, prepareSource: async () => prepared, runtimeFactory: createSampleProcessRuntimeFactory() })
  const result = await service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection })
  if (!result.ok) throw new Error('fixture task rejected')
  for await (const _event of result.events) {}
  return { root, workspace: join(root, 'project-local', ID), service }
}

function correction(recordId: string, text: string) {
  return { expectedSourceRevision: 1, corrections: [{ recordId, expectedRecordRevision: 1, text }] }
}

describe('paper task source corrections', () => {
  it('marks only the translation master paragraphs that depend on a corrected record', async () => {
    const { service, workspace } = await completedTask('translation')
    const directory = join(workspace, 'drafts', 'translation')
    const master = '# 主稿\n\n第一段译文。\n\n第二段译文。'
    writeFileSync(join(directory, 'master.md'), master)
    writeFileSync(join(directory, 'translation.json'), JSON.stringify({
      version: 1,
      status: 'complete',
      sourceRevision: 1,
      masterSha256: createHash('sha256').update(master).digest('hex'),
      segments: [
        { index: 0, markdown: '# 主稿\n\n第一段译文。', stale: false, dependencies: [{ recordId: 'p1-r1', revision: 1 }] },
        { index: 1, markdown: '第二段译文。', stale: false, dependencies: [{ recordId: 'p1-r0', revision: 1 }] },
      ],
      terminology: [],
      unresolved: [],
      assets: [],
    }))

    expect(service.correctSource(ID, correction('p1-r1', 'Corrected body 47.5%.'))).toEqual({ kind: 'corrected', revision: 2 })

    const metadata = JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8'))
    expect(metadata).toMatchObject({ status: 'needs-update', sourceRevision: 2 })
    expect(metadata.segments[0]).toMatchObject({ index: 0, stale: true, markdown: '# 主稿\n\n第一段译文。' })
    expect(metadata.segments[1]).toMatchObject({ index: 1, stale: false, markdown: '第二段译文。' })
    expect(readFileSync(join(directory, 'master.md'), 'utf8')).toBe(master)
    expect(service.translation(ID)).toMatchObject({
      status: 'needs-update', markdown: master, staleParagraphs: [0], unresolved: [], assets: [],
    })

    expect(service.correctSource(ID, {
      expectedSourceRevision: 2,
      corrections: [{ recordId: 'p1-r0', expectedRecordRevision: 1, text: '1 Overview revised' }],
    })).toEqual({ kind: 'corrected', revision: 3 })
    const second = JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8'))
    expect(second).toMatchObject({ status: 'needs-update', sourceRevision: 3 })
    expect(second.segments.map((segment: { readonly stale: boolean }) => segment.stale)).toEqual([true, true])
  })

  it('changes only dependent source records and piece states while retaining original and draft bytes', async () => {
    const { service, workspace } = await completedTask()
    const original = readFileSync(join(workspace, 'original.pdf'))
    const heading = readFileSync(join(workspace, 'source-records', 'p1-r0.json'))
    const gap = readFileSync(join(workspace, 'source-records', 'p2-r0.json'))
    const draft = readFileSync(join(workspace, 'drafts', 'translation', 'draft.json'))
    const unchangedPiece = readFileSync(join(workspace, 'drafts', 'translation', 'pieces', 'translation-p1-r0.json'))

    expect(service.correctSource(ID, correction('p1-r1', 'Corrected body 47.5%.'))).toEqual({ kind: 'corrected', revision: 2 })

    expect(service.source(ID)?.source.records.find((record) => record.id === 'p1-r1')).toMatchObject({ text: 'Corrected body 47.5%.', revision: 2 })
    expect(service.source(ID)?.source.records.find((record) => record.id === 'p1-r2')).toMatchObject({ text: 'Final body.', context: 'Corrected body 47.5%.', revision: 2 })
    expect(service.source(ID)?.source.status).toBe('incomplete')
    expect(readFileSync(join(workspace, 'original.pdf'))).toEqual(original)
    expect(readFileSync(join(workspace, 'source-records', 'p1-r0.json'))).toEqual(heading)
    expect(readFileSync(join(workspace, 'source-records', 'p2-r0.json'))).toEqual(gap)
    expect(readFileSync(join(workspace, 'drafts', 'translation', 'draft.json'))).toEqual(draft)
    expect(readFileSync(join(workspace, 'drafts', 'translation', 'pieces', 'translation-p1-r0.json'))).toEqual(unchangedPiece)
    for (const branch of ['translation', 'deep-reading']) {
      for (const id of ['p1-r1', 'p1-r2']) {
        expect(JSON.parse(readFileSync(join(workspace, 'drafts', branch, 'pieces', `${branch}-${id}.json`), 'utf8')).stale).toBe(true)
      }
    }
  })

  it('corrects a selected single branch without requiring an unselected result', async () => {
    const { service } = await completedTask('translation')
    expect(service.correctSource(ID, correction('p1-r1', 'Corrected body 47.5%.'))).toEqual({ kind: 'corrected', revision: 2 })
  })

  it('leaves all versions and files unchanged for a no-op', async () => {
    const { service, workspace } = await completedTask()
    const record = readFileSync(join(workspace, 'source-records', 'p1-r1.json'))
    expect(service.correctSource(ID, correction('p1-r1', 'Body one 47.5%.'))).toEqual({ kind: 'unchanged', revision: 1 })
    expect(readFileSync(join(workspace, 'source-records', 'p1-r1.json'))).toEqual(record)
  })

  it('rejects an outdated source revision and an unknown record', async () => {
    const { service } = await completedTask()
    expect(service.correctSource(ID, { ...correction('p1-r1', 'Changed.'), expectedSourceRevision: 2 })).toEqual({ kind: 'conflict' })
    expect(service.correctSource(ID, correction('p9-r9', 'Changed.'))).toEqual({ kind: 'invalid' })
    expect(service.source(ID)?.revision).toBe(1)
  })

  it('does not fabricate missing original content through a text-only correction', async () => {
    const { service } = await completedTask()
    expect(service.correctSource(ID, correction('p2-r0', 'Guessed missing text.'))).toEqual({ kind: 'invalid' })
    expect(service.source(ID)?.source.status).toBe('incomplete')
  })

  it('does not lose a text correction when that same record depends on another corrected record', async () => {
    const { service } = await completedTask()
    const corrections = [
      { recordId: 'p1-r1', expectedRecordRevision: 1, text: 'Corrected body 47.5%.' },
      { recordId: 'p1-r2', expectedRecordRevision: 1, text: 'Corrected final body.' },
    ]
    expect(service.correctSource(ID, { expectedSourceRevision: 1, corrections })).toEqual({ kind: 'corrected', revision: 2 })
    expect(service.source(ID)?.source.records.find((record) => record.id === 'p1-r2')).toMatchObject({ text: 'Corrected final body.', context: 'Corrected body 47.5%.', revision: 2 })
  })

  it('does not recover retained tasks into a fresh service', async () => {
    const { service, root } = await completedTask()
    expect(service.source(ID)).toBeDefined()
    expect(createPaperTaskService({ projectRoot: root }).source(ID)).toBeUndefined()
  })

  it('fences a partially published correction instead of exposing mixed source versions', async () => {
    const { service, workspace } = await completedTask()
    const obstructed = join(workspace, 'source-records', 'p1-r2.json')
    rmSync(obstructed)
    mkdirSync(obstructed)
    expect(service.correctSource(ID, correction('p1-r1', 'Corrected body 47.5%.'))).toEqual({ kind: 'unavailable' })
    expect(service.source(ID)).toBeUndefined()
  })

  it('rejects correction before the submitted stream starts without cancelling it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-before-start-'))
    roots.push(root)
    const service = createPaperTaskService({ projectRoot: root, createId: () => ID, prepareSource: async () => prepared, runtimeFactory: createSampleProcessRuntimeFactory() })
    const submitted = await service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task rejected')
    expect(service.correctSource(ID, correction('p1-r1', 'Changed.'))).toEqual({ kind: 'unavailable' })
    let succeeded = false
    for await (const event of submitted.events) {
      if (event.type === 'terminal') succeeded = event.outcome === 'succeeded'
    }
    expect(succeeded).toBe(true)
  })

  it('rejects correction when runtime cleanup failed even after the terminal event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-failed-cleanup-'))
    roots.push(root)
    const service = createPaperTaskService({
      projectRoot: root, createId: () => ID, prepareSource: async () => prepared,
      runtimeFactory: () => ({
        events: async function* () { yield { type: 'preview', paragraphs: ['Sample'], pieces: [] } },
        result: Promise.resolve({ ok: true }), close: async () => ({ ok: false }),
      }),
    })
    const submitted = await service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task rejected')
    for await (const _event of submitted.events) {}
    expect(service.correctSource(ID, correction('p1-r1', 'Changed.'))).toEqual({ kind: 'unavailable' })
    expect(service.source(ID)?.revision).toBe(1)
  })
})
