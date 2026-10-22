/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import type { PaperTaskRuntimeFactory } from '../../server/paper-task/runtime'
import { writeTaskInput } from '../../server/paper-task/input'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1])
const PREPARED_SOURCE: PaperTaskSourceResult = {
  success: true,
  source: {
    status: 'incomplete',
    pageCount: 1,
    records: [
      {
        id: 'p1-r0', order: 0, kind: 'body', text: 'source line', state: 'present', page: 1,
        bbox: [10, 20, 90, 12], sectionId: null, context: '', links: [],
      },
      {
        id: 'p1-r1', order: 1, kind: 'table', text: 'Table 1: values', state: 'present', page: 1,
        bbox: [10, 40, 90, 30], sectionId: null, context: 'source line', links: [],
      },
    ],
  },
  assets: [{
    recordId: 'p1-r1', page: 1, bbox: [10, 40, 90, 30], availability: 'available',
    understanding: 'unverified', mediaType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  }],
}

const noRuntime: PaperTaskRuntimeFactory = () => {
  throw new Error('runtime not expected before the event stream is consumed')
}

let roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function makeService() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'paper-task-preparation-'))
  roots.push(projectRoot)
  return createPaperTaskService({
    projectRoot,
    runtimeFactory: noRuntime,
    prepareSource: async () => PREPARED_SOURCE,
    createId: () => TASK_ID,
  })
}

describe('paper-task source preparation storage', () => {
  it('creates one immutable task instruction file for the selected generation attempt', () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-input-'))
    roots.push(root)

    const path = writeTaskInput(root, TASK_ID, 'deep-reading')
    expect(path).toBe(join(root, 'task-input.md'))
    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0)
    expect(() => writeTaskInput(root, TASK_ID, 'deep-reading')).toThrow()
  })

  it('submits a task and exposes ordered, revisioned prepared records without excerpt truncation', async () => {
    // Given: a typed preparation result with an unresolved page gap.
    const service = makeService()

    // When: the task is submitted and its preparation completes.
    const submission = await service.submit({ pdf: PDF_BYTES, selection: 'translation' })
    if (!submission.ok) throw new Error('submission failed')
    for await (const _event of submission.events) {
    }
    const prepared = service.source(TASK_ID)

    // Then: the source seam retains each record and its current revision.
    expect(prepared?.source.records.map((record) => [record.id, record.order, record.revision])).toEqual([
      ['p1-r0', 0, 1],
      ['p1-r1', 1, 1],
    ])
    expect(prepared?.source.status).toBe('incomplete')
    expect(prepared?.assets).toHaveLength(1)
  })
})
