/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskSource } from '../../app/utils/paper-task-source-contract'
import { paperTaskSourceView } from '../../server/paper-task/source-access'
import { createPaperTaskSourceStore } from '../../server/paper-task/source-store'
import { createPaperTaskWorkspace } from '../../server/paper-task/workspace'
import { readPaperTaskImageReceipts, savePaperTaskImageReceipts } from '../../server/paper-task/image-receipts'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const roots: string[] = []

function workspace(taskId = TASK_ID): string {
  const root = join(mkdtempSync(join(tmpdir(), 'paper-task-image-receipts-')), taskId)
  roots.push(root)
  mkdirSync(root)
  createPaperTaskWorkspace(root, new Uint8Array())
  return root
}

function receipt(overrides: Partial<PaperTaskImageReceipt> = {}): PaperTaskImageReceipt {
  return {
    branch: 'translation', assetId: 'asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', recordId: 'p1-r0',
    revision: 1, status: 'transported', reason: null, ...overrides,
  }
}

function source(): PaperTaskSource {
  return { status: 'complete', pageCount: 1, records: [{
    id: 'p1-r0', order: 0, kind: 'formula', text: 'x = 1', state: 'present', page: 1,
    bbox: [1, 2, 3, 4], sectionId: null, context: '', links: [],
  }] }
}

function metadata(root: string, revision = 1): void {
  writeFileSync(join(root, 'assets', 'asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'), JSON.stringify({ id: 'asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', recordId: 'p1-r0' }))
  writeFileSync(join(root, 'assets', 'asset-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'), JSON.stringify({ id: 'asset-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', recordId: 'p1-r0' }))
  writeFileSync(join(root, 'source-records', 'p1-r0.json'), JSON.stringify({ record: source().records[0], revision }))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(join(root, '..'), { recursive: true, force: true })
})

describe('paper task image receipt persistence', () => {
  it('saves metadata only and reads the receipt for the matching task and branch', () => {
    // Given a task workspace with matching source record and asset metadata.
    const root = workspace()
    metadata(root)

    // When the translation receipt is saved and read.
    savePaperTaskImageReceipts(root, 'translation', [receipt()])
    const stored = readPaperTaskImageReceipts(root, [{ record: { id: 'p1-r0' }, revision: 1 }], [{ id: receipt().assetId, recordId: 'p1-r0' }])

    // Then only the canonical metadata is available to that same branch.
    expect(stored).toEqual([receipt()])
    expect(readPaperTaskImageReceipts(root, [{ record: { id: 'p1-r0' }, revision: 1 }], [])).toEqual([])
    expect(() => savePaperTaskImageReceipts(root, 'deep-reading', [receipt()])).toThrow()
  })

  it('updates an owned receipt file as provider status changes', () => {
    // Given a matching task workspace with one source asset.
    const root = workspace()
    metadata(root)

    // When the receipt is successively saved after transport and blocking.
    const initial = receipt({ status: 'not-sent', reason: 'unwired' })
    savePaperTaskImageReceipts(root, 'translation', [initial])
    savePaperTaskImageReceipts(root, 'translation', [receipt({ status: 'transported' })])
    const blocked = receipt({ status: 'blocked', reason: 'provider-failed' })
    savePaperTaskImageReceipts(root, 'translation', [blocked])

    // Then the owned file exposes the latest status.
    expect(JSON.parse(readFileSync(join(root, 'drafts', 'translation', 'image-input.json'), 'utf8')).receipts).toEqual([blocked])
  })

  it('reads the same asset for both branches and multiple assets for one record', () => {
    // Given two branch receipts and two assets associated with one source record.
    const root = workspace()
    metadata(root)
    const translation = receipt()
    const deepReading = receipt({ branch: 'deep-reading' })
    const secondAsset = receipt({ assetId: 'asset-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
    savePaperTaskImageReceipts(root, 'translation', [translation, secondAsset])
    savePaperTaskImageReceipts(root, 'deep-reading', [deepReading])

    // When receipts are read against current record and asset associations.
    const stored = readPaperTaskImageReceipts(
      root,
      [{ record: { id: 'p1-r0' }, revision: 1 }],
      [
        { id: translation.assetId, recordId: 'p1-r0' },
        { id: secondAsset.assetId, recordId: 'p1-r0' },
      ],
    )

    // Then distinct branches and asset ids for the shared record are retained.
    expect(stored).toHaveLength(3)
    expect(stored).toEqual(expect.arrayContaining([translation, deepReading, secondAsset]))
  })

  it('rejects sibling task reuse and a receipt file with the wrong task identity', () => {
    // Given matching source metadata and a sibling task workspace.
    const root = workspace()
    const sibling = workspace('123e4567-e89b-12d3-a456-426614174001')
    metadata(root)
    metadata(sibling)
    savePaperTaskImageReceipts(root, 'translation', [receipt()])

    // When the sibling receives the copied receipt file.
    writeFileSync(join(sibling, 'drafts', 'translation', 'image-input.json'), JSON.stringify({ taskId: TASK_ID, branch: 'translation', receipts: [receipt()] }))

    // Then the sibling cannot expose the foreign receipt.
    expect(readPaperTaskImageReceipts(sibling, [{ record: { id: 'p1-r0' }, revision: 1 }], [{ id: receipt().assetId, recordId: 'p1-r0' }])).toEqual([])
    expect(() => savePaperTaskImageReceipts(sibling, 'translation', [receipt()])).toThrow()
  })

  it('does not follow a symlinked branch path', () => {
    // Given valid metadata and a branch directory replaced by a symlink.
    const root = workspace()
    metadata(root)
    const outside = mkdtempSync(join(tmpdir(), 'paper-task-outside-'))
    roots.push(join(outside, TASK_ID))
    rmSync(join(root, 'drafts', 'translation'), { recursive: true, force: true })
    symlinkSync(outside, join(root, 'drafts', 'translation'), 'junction')

    // When a receipt is saved through that branch path.
    const save = () => savePaperTaskImageReceipts(root, 'translation', [receipt()])

    // Then the path is rejected and no outside receipt is created.
    expect(save).toThrow()
    expect(() => readPaperTaskImageReceipts(root, [], [])).not.toThrow()
  })

  it('marks changed record revisions stale and projects them as unverified', () => {
    // Given a valid persisted receipt whose source record later changes revision.
    const root = workspace()
    const store = createPaperTaskSourceStore()
    const paperSource = source()
    store.save(TASK_ID, root, paperSource, [{ recordId: 'p1-r0', page: 1, bbox: [1, 2, 3, 4], availability: 'available', understanding: 'unverified', mediaType: 'image/png', bytes: null }])
    const storedSource = store.read(TASK_ID, root)
    const asset = storedSource?.assets[0]
    if (asset === undefined) throw new Error('Expected stored image asset.')
    const savedReceipt = receipt({ assetId: asset.id })
    savePaperTaskImageReceipts(root, 'translation', [savedReceipt])
    metadata(root, 2)
    if (storedSource === undefined) throw new Error('Expected stored source.')
    const stored = {
      ...storedSource,
      source: { ...storedSource.source, records: storedSource.source.records.map((record) => ({ ...record, revision: 2 })) },
      imageInputs: readPaperTaskImageReceipts(root, [{ record: { id: 'p1-r0' }, revision: 2 }], [asset]),
    }

    // When the public source view is projected.
    const view = paperTaskSourceView(TASK_ID, stored)

    // Then the receipt communicates staleness without upgrading understanding.
    expect(view.assets[0]?.inputs).toEqual([{ ...savedReceipt, status: 'blocked', reason: 'stale-source' }])
    expect(view.assets[0]?.understanding).toBe('unverified')
  })
})
