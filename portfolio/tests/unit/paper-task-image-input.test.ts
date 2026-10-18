/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePaperTaskImages, decodePaperTaskPng } from '../../server/paper-task/image-input'

const roots: string[] = []
const assetId = 'asset-0123456789abcdef0123456789abcdef'

async function fixture(availability: 'available' | 'unavailable' = 'available'): Promise<{ readonly root: string; readonly png: Uint8Array }> {
  const root = await mkdtemp(join(tmpdir(), 'paper-task-image-'))
  roots.push(root)
  const assets = join(root, 'assets')
  const records = join(root, 'source-records')
  await mkdir(assets)
  await mkdir(records)
  const png = new Uint8Array(createCanvas(2, 3).toBuffer('image/png'))
  await writeFile(join(root, 'source-index.json'), JSON.stringify(['p1-r1']))
  await writeFile(join(records, 'p1-r1.json'), JSON.stringify({ revision: 2, record: { id: 'p1-r1', kind: 'formula', state: 'present', page: 1, bbox: [1, 2, 3, 4], text: 'a = b', context: 'Equation 1' } }))
  await writeFile(join(assets, `${assetId}.json`), JSON.stringify({ id: assetId, recordId: 'p1-r1', page: 1, bbox: [1, 2, 3, 4], availability }))
  if (availability === 'available') await writeFile(join(assets, `${assetId}.png`), png)
  return { root, png }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('paper task prepared image input', () => {
  it('decodes real PNG pixels after enforcing PNG header bounds', async () => {
    // Given a PNG produced by the native canvas encoder.
    const { png } = await fixture()

    // When its image pixels are decoded.
    const decoded = await decodePaperTaskPng(png)

    // Then dimensions and a fidelity digest are available.
    expect(decoded).toMatchObject({ width: 2, height: 3 })
    expect(decoded.pixelDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('selects a present record and binds its numbered context to the PNG', async () => {
    // Given a valid asset associated with a present formula record.
    const { root, png } = await fixture()

    // When image preparation is enabled for translation.
    const result = await preparePaperTaskImages(root, 'translation', true)
    const image = result.images[0]

    // Then the payload carries the exact image and task-scoped source context, but no path.
    expect(image?.data).toBe(Buffer.from(png).toString('base64'))
    expect(JSON.parse(image?.context ?? '{}')).toMatchObject({ taskId: root.split(/[\\/]/).at(-1), branch: 'translation', recordId: 'p1-r1', revision: 2, page: 1, kind: 'formula', text: 'a = b', context: 'Equation 1' })
    expect(image?.context).not.toContain(root)
    expect(result.receipts[0]).toMatchObject({ status: 'not-sent', reason: 'unwired' })
  })

  it('reports disabled and missing image states without admitting image bytes', async () => {
    // Given a valid available asset and a metadata-only unavailable asset.
    const disabledFixture = await fixture()
    const unavailableFixture = await fixture('unavailable')

    // When preparation is disabled and then run with unavailable metadata.
    const disabled = await preparePaperTaskImages(disabledFixture.root, 'deep-reading', false)
    const missing = await preparePaperTaskImages(unavailableFixture.root, 'deep-reading', true)

    // Then neither outcome supplies pixels and each reason is explicit.
    expect(disabled.images).toHaveLength(0)
    expect(disabled.receipts[0]).toMatchObject({ status: 'not-sent', reason: 'not-enabled' })
    expect(missing.images).toHaveLength(0)
    expect(missing.receipts[0]).toMatchObject({ status: 'blocked', reason: 'missing' })
  })

  it('rejects corrupt PNG and a symlinked PNG outside the task root', async () => {
    // Given one corrupt PNG and one valid-looking asset whose bytes escape the root.
    const corrupt = await fixture()
    await writeFile(join(corrupt.root, 'assets', `${assetId}.png`), new Uint8Array([137, 80, 78, 71]))
    const foreign = await fixture()
    const outside = join(foreign.root, 'foreign.png')
    await writeFile(outside, foreign.png)
    await rm(join(foreign.root, 'assets', `${assetId}.png`))
    await symlink(outside, join(foreign.root, 'assets', `${assetId}.png`))

    // When each asset is prepared.
    const corruptResult = await preparePaperTaskImages(corrupt.root, 'translation', true)
    const foreignResult = await preparePaperTaskImages(foreign.root, 'translation', true)

    // Then malformed bytes and symlink paths are blocked.
    expect(corruptResult.receipts[0]).toMatchObject({ status: 'blocked', reason: 'invalid-image' })
    expect(foreignResult.receipts[0]).toMatchObject({ status: 'blocked', reason: 'unreadable' })
  })

  it('rejects PNGs exceeding the pixel, dimension, and encoded-byte limits before decoding', async () => {
    // Given PNG headers declaring excessive dimensions or an oversized byte array.
    const header = (width: number, height: number): Uint8Array => {
      const bytes = new Uint8Array(24)
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
      bytes.set([73, 72, 68, 82], 12)
      new DataView(bytes.buffer).setUint32(16, width)
      new DataView(bytes.buffer).setUint32(20, height)
      return bytes
    }

    // When the bounded PNG decoder checks each invalid input.
    const pixelLimit = decodePaperTaskPng(header(1501, 1000))
    const dimensionLimit = decodePaperTaskPng(header(8193, 1))
    const byteLimit = decodePaperTaskPng(new Uint8Array(8 * 1024 * 1024 + 1))

    // Then each input is rejected with the corresponding limit reason.
    await expect(pixelLimit).rejects.toThrow('image-too-many-pixels')
    await expect(dimensionLimit).rejects.toThrow('image-dimension-too-large')
    await expect(byteLimit).rejects.toThrow('image-too-large')
  })

  it('reports count and context overflow without adding omitted image payloads', async () => {
    // Given five visual assets, with one carrying context over the per-image bound.
    const { root, png } = await fixture()
    const assets = join(root, 'assets')
    const records = join(root, 'source-records')
    const ids = ['p1-r1']
    for (let index = 2; index <= 6; index += 1) {
      const recordId = `p1-r${index}`
      const nextAssetId = `asset-${String(index).padStart(32, '0')}`
      ids.push(recordId)
      await writeFile(join(records, `${recordId}.json`), JSON.stringify({ revision: 1, record: { id: recordId, kind: 'table', state: 'present', page: 1, bbox: [0, 0, 1, 1], text: index === 2 ? 'x'.repeat(20_001) : 'T', context: '' } }))
      await writeFile(join(assets, `${nextAssetId}.json`), JSON.stringify({ id: nextAssetId, recordId, page: 1, bbox: [0, 0, 1, 1], availability: 'available' }))
      await writeFile(join(assets, `${nextAssetId}.png`), png)
    }
    await writeFile(join(root, 'source-index.json'), JSON.stringify(ids))

    // When all assets are prepared in stable source order.
    const result = await preparePaperTaskImages(root, 'translation', true)

    // Then the context overflow and fifth otherwise-eligible image are both explicitly blocked.
    expect(result.images).toHaveLength(4)
    expect(result.receipts.filter((item) => item.reason === 'context-too-large')).toHaveLength(1)
    expect(result.receipts.filter((item) => item.reason === 'too-many-images')).toHaveLength(1)
  })

  it('follows source index order and applies the context limit per image', async () => {
    // Given filenames that sort opposite to source order and two contexts below the individual limit.
    const { root, png } = await fixture()
    const firstAssetId = 'asset-ffffffffffffffffffffffffffffffff'
    const longText = 'x'.repeat(11_000)
    await writeFile(join(root, 'source-index.json'), JSON.stringify(['p1-r2', 'p1-r1']))
    await writeFile(join(root, 'source-records', 'p1-r1.json'), JSON.stringify({ revision: 1, record: { id: 'p1-r1', kind: 'formula', state: 'present', page: 1, bbox: [1, 2, 3, 4], text: longText, context: '' } }))
    await writeFile(join(root, 'source-records', 'p1-r2.json'), JSON.stringify({ revision: 1, record: { id: 'p1-r2', kind: 'formula', state: 'present', page: 1, bbox: [1, 2, 3, 4], text: longText, context: '' } }))
    await writeFile(join(root, 'assets', `${assetId}.json`), JSON.stringify({ id: assetId, recordId: 'p1-r1', page: 1, bbox: [1, 2, 3, 4], availability: 'available' }))
    await writeFile(join(root, 'assets', `${firstAssetId}.json`), JSON.stringify({ id: firstAssetId, recordId: 'p1-r2', page: 1, bbox: [1, 2, 3, 4], availability: 'available' }))
    await writeFile(join(root, 'assets', `${firstAssetId}.png`), png)

    // When image preparation runs for the ordered source records.
    const result = await preparePaperTaskImages(root, 'translation', true)

    // Then source order wins over filename order and both individually bounded contexts are admitted.
    expect(result.images.map((image) => image.recordId)).toEqual(['p1-r2', 'p1-r1'])
    expect(result.images).toHaveLength(2)
    expect(result.images.every((image) => Buffer.byteLength(image.context) <= 20_000)).toBe(true)
  })
})
