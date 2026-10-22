/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { PaperTaskSource, PaperTaskSourceAsset } from '../../app/utils/paper-task-source-contract'
import { createPaperTaskSourceStore } from '../../server/paper-task/source-store'
import { createPaperTaskWorkspace, workspacePaths } from '../../server/paper-task/workspace'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const roots: string[] = []
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const retainedStateSchema = z.object({
  revision: z.number(),
  assets: z.array(z.object({
    id: z.string().regex(/^asset-[0-9a-f]{32}$/),
    recordId: z.string(),
    availability: z.enum(['available', 'unavailable']),
    understanding: z.literal('unverified'),
    relativePath: z.string().nullable(),
  }).strict()),
})

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-source-store-'))
  roots.push(root)
  createPaperTaskWorkspace(root, new Uint8Array())
  const source: PaperTaskSource = {
    status: 'complete',
    pageCount: 1,
    records: [{
      id: 'p1-r0', order: 0, kind: 'formula', text: 'x = 1', state: 'present', page: 1,
      bbox: [1, 2, 3, 4], sectionId: null, context: '', links: [],
    }],
  }
  const assets: readonly PaperTaskSourceAsset[] = [
    {
      recordId: 'p1-r0', page: 1, bbox: [1, 2, 3, 4], availability: 'available',
      understanding: 'unverified', mediaType: 'image/png', bytes: PNG_BYTES,
    },
    {
      recordId: 'p1-r0', page: 1, bbox: [5, 6, 7, 8], availability: 'unavailable',
      understanding: 'unverified', mediaType: 'image/png', bytes: null,
    },
  ]
  const store = createPaperTaskSourceStore()
  store.save(TASK_ID, root, source, assets)
  return { root, source, store }
}

function readRetainedState(root: string) {
  return retainedStateSchema.parse(JSON.parse(readFileSync(workspacePaths(root).sourceStatePath, 'utf8')))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paper task source store retained assets', () => {
  it('persists minimal truthful references to readable available images', () => {
    // Given a retained source with one available image and one unavailable image.
    const { root, store } = createSourceFixture()

    // When the saved references are read from retained source state.
    const state = readRetainedState(root)
    const available = state.assets.find((asset) => asset.availability === 'available')
    const unavailable = state.assets.find((asset) => asset.availability === 'unavailable')
    if (available === undefined || unavailable === undefined) throw new Error('Expected both retained asset entries.')

    // Then available assets stay explicitly unverified and resolve to the stored PNG.
    expect(available).toEqual({
      id: available.id, recordId: 'p1-r0', availability: 'available',
      understanding: 'unverified', relativePath: `../../assets/${available.id}.png`,
    })
    expect(store.readAsset(TASK_ID, root, available.id)).toEqual(PNG_BYTES)
    expect(unavailable).toMatchObject({
      availability: 'unavailable', understanding: 'unverified', relativePath: null,
    })
  })

  it('preserves asset references and unverified status after source correction', () => {
    // Given a saved source with retained asset references.
    const { root, source, store } = createSourceFixture()
    const retainedAssets = readRetainedState(root).assets
    const originalRecord = source.records[0]
    if (originalRecord === undefined) throw new Error('Expected a source record.')
    const correctedRecord = { ...originalRecord, text: 'x = 2' }

    // When the source record is corrected to its next revision.
    store.replace(TASK_ID, root, { ...source, records: [correctedRecord] }, [
      { record: correctedRecord, revision: 2 },
    ], 2)

    // Then the correction retains the same truthful asset metadata.
    const correctedState = readRetainedState(root)
    expect(correctedState.revision).toBe(2)
    expect(correctedState.assets).toEqual(retainedAssets)
  })
})
