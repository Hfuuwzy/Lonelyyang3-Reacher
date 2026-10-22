/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import type { PaperTaskRuntimeFactory } from '../../server/paper-task/runtime'
import type { PreparedPaperTaskSource } from '../../server/paper-task/source-acquisition'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])
const COMPLETE_SOURCE: PreparedPaperTaskSource = {
  success: true,
  source: {
    status: 'complete',
    pageCount: 1,
    records: [{
      id: 'p1-r0', order: 0, kind: 'body', text: 'Prepared complete paper.', state: 'present', page: 1,
      bbox: [10, 20, 90, 12], sectionId: null, context: '', links: [],
    }],
  },
  assets: [],
}

const runtimeThatFailsWithoutCallingAModel: PaperTaskRuntimeFactory = () => {
  throw new Error('The test does not launch a model runtime.')
}

let projectRoots: string[] = []

afterEach(() => {
  for (const root of projectRoots) rmSync(root, { recursive: true, force: true })
  projectRoots = []
})

describe('paper-task source flow', () => {
  it('uses the acquired full text as the shared task source without re-parsing or creating another generation flow', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paper-task-source-flow-'))
    projectRoots.push(projectRoot)
    const service = createPaperTaskService({
      projectRoot,
      createId: () => TASK_ID,
      runtimeFactory: runtimeThatFailsWithoutCallingAModel,
      prepareSource: async () => ({ success: false, error: { code: 'read-failed' } }),
    })

    const submission = await service.submit(
      { pdf: PDF_BYTES, selection: 'translation' },
      { preparedSource: COMPLETE_SOURCE },
    )
    if (!submission.ok) throw new Error('The acquired PDF was not accepted as a paper task.')
    for await (const _event of submission.events) {
      // Consume the task stream without starting a model runtime.
    }

    expect(service.source(TASK_ID)?.source).toMatchObject({ status: 'complete', pageCount: 1 })
    expect(service.source(TASK_ID)?.source.records[0]?.text).toBe('Prepared complete paper.')
  })
})
