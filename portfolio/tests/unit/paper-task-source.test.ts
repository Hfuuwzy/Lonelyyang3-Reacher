/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { preparePaperTaskSource } from '../../server/paper-task/source'
import { buildSamplePdf } from '../fixtures/generate-paper-review-sample.mjs'

function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../fixtures/paper-task-source-fixture.pdf', import.meta.url)))
}

describe('preparePaperTaskSource', () => {
  it('does not expose a caption-only crop for a second populated table on the same page', async () => {
    const bytes = buildSamplePdf([{ lines: [
      'Table 1: First',
      { runs: [{ text: 'Group', x: 72 }, { text: 'Count', x: 260 }] },
      { runs: [{ text: 'First', x: 72 }, { text: '120', x: 260 }] },
      'Notes: first table.', 'Intervening text.', 'Intervening text.', 'Intervening text.', 'Intervening text.',
      'Table 2: Second',
      { runs: [{ text: 'Group', x: 72 }, { text: 'Count', x: 260 }] },
      { runs: [{ text: 'Second', x: 72 }, { text: '115', x: 260 }] },
    ] }])
    const result = await preparePaperTaskSource(bytes)
    if (!result.success) throw new Error('Controlled two-table document failed preparation')
    const second = result.source.records.find((record) => record.kind === 'table' && record.text.includes('Table 2: Second'))
    expect(second?.state).toBe('ambiguous')
    expect(result.assets.find((asset) => asset.recordId === second?.id)?.availability).toBe('unavailable')
    expect(result.source.status).toBe('incomplete')
  })
  it('preserves ordered whole-paper records, safe links, PNG crops, and unrecoverable pages', async () => {
    // Given a genuine three-page PDF containing text, link annotations, and a blank page.
    const bytes = fixtureBytes()

    // When it is prepared through the task source interface.
    const result = await preparePaperTaskSource(bytes)

    // Then every page is represented and content remains source-verifiable.
    expect(result.success, JSON.stringify(result)).toBe(true)
    if (!result.success) throw new Error(`unexpected source failure: ${result.error.code}`)
    expect(result.source.pageCount).toBe(3)
    expect(result.source.records.map((record) => record.order)).toEqual(
      result.source.records.map((_, index) => index),
    )
    expect(result.source.records.map((record) => record.kind)).toEqual(expect.arrayContaining([
      'heading', 'body', 'appendix', 'footnote', 'reference', 'table', 'formula', 'algorithm', 'gap',
    ]))
    expect(result.source.records.map((record) => record.text).join('\n')).toContain('47.5%')
    const equation = result.source.records.find((record) => record.kind === 'formula')
    expect(equation?.text).toBe('E = m c^2 (1)')
    expect(equation?.context).toBe('The relation is defined as follows.')
    const equationAsset = result.assets.find((asset) => asset.recordId === equation?.id)
    expect(equationAsset?.availability).toBe('available')
    expect(equationAsset?.bbox[1]).toBeLessThan(198)
    const table = result.source.records.find((record) => record.kind === 'table')
    expect(table?.text).toContain('Table 1: Measurements (units)')
    expect(table?.text).toContain('Method 115 52.0%')
    expect(table?.text).toContain('Notes: percentages use the full cohort.')
    const algorithm = result.source.records.filter((record) => record.kind === 'algorithm')
    expect(algorithm).toHaveLength(1)
    expect(algorithm[0]?.text).toContain('Algorithm 1: Stable update')
    expect(algorithm[0]?.text).toContain('2. Update using the measured gradient.')
    expect(result.source.records.some((record) => record.state === 'ambiguous'
      && record.kind === 'body' && record.text.includes('Left column statement.'))).toBe(true)
    expect(result.source.records.find((record) => record.kind === 'appendix')?.sectionId).not.toBeNull()
    expect(result.source.records.find((record) => record.kind === 'footnote')?.page).toBe(2)
    expect(result.source.status).toBe('incomplete')
    expect(result.source.records.find((record) => record.kind === 'gap')?.state).toBe('unrecovered')
    expect(result.source.records.flatMap((record) => record.links)).toEqual([{
      kind: 'reference', url: 'https://example.org/data',
    }, { kind: 'original', url: 'pdf://2' }])
    expect(result.assets.length).toBeGreaterThan(0)
    expect(result.assets.map((asset) => result.source.records.find((record) => record.id === asset.recordId)?.kind))
      .toEqual(expect.arrayContaining(['table', 'formula', 'algorithm']))
    for (const kind of ['formula', 'algorithm'] as const) {
      expect(result.assets.filter((asset) =>
        result.source.records.find((record) => record.id === asset.recordId)?.kind === kind,
      )).toHaveLength(1)
    }
    expect(result.assets.filter((asset) =>
      result.source.records.find((record) => record.id === asset.recordId)?.kind === 'table',
    )).toHaveLength(2)
    expect(result.assets.every((asset) => asset.understanding === 'unverified')).toBe(true)
    const captionOnlyTable = result.source.records.find((record) => record.text.includes('Table 2: Caption only'))
    expect(captionOnlyTable?.state).toBe('ambiguous')
    expect(result.assets.find((asset) => asset.recordId === captionOnlyTable?.id)?.availability).toBe('unavailable')
    const available = result.assets.filter((asset) => asset.availability === 'available')
    expect(available.length).toBeGreaterThan(0)
    expect(available.every((asset) => {
      const signature = asset.bytes?.slice(0, 8)
      return signature !== undefined && [...signature].join(',') === '137,80,78,71,13,10,26,10'
    })).toBe(true)
    const tableAsset = available.find((asset) =>
      result.source.records.find((record) => record.id === asset.recordId)?.text.includes('Table 1:'),
    )
    expect(tableAsset?.bbox[3]).toBeGreaterThan(100)
    expect(tableAsset?.bbox[0]).toBeLessThan(100)
    expect(tableAsset?.bbox[2]).toBeLessThan(500)
    if (tableAsset === undefined) throw new Error('Expected a rendered table crop.')
    expect(tableAsset.bbox[1] + tableAsset.bbox[3]).toBeLessThanOrEqual(174)
    const tablePng = tableAsset?.bytes
    expect(tablePng).toBeDefined()
    if (tablePng === undefined || tablePng === null || tableAsset === undefined) throw new Error('Expected a rendered table crop.')
    const tableImage = new DataView(tablePng.buffer, tablePng.byteOffset, tablePng.byteLength)
    expect(tableImage.getUint32(16)).toBeGreaterThan(tableAsset.bbox[2] * 1.8)
    expect(result.source.status).toBe('incomplete')
  })

  it('keeps bibliographic continuation lines on later pages as English references', async () => {
    // Given references that continue across a page boundary.
    const bytes = buildSamplePdf([
      { lines: ['References', '1. Smith, J. (2020). First study.'] },
      { lines: ['Continuation of the second entry.', '2. Doe, A. (2021). Second study.'] },
    ])

    // When the source is prepared.
    const result = await preparePaperTaskSource(bytes)
    if (!result.success) throw new Error('controlled bibliography document failed preparation')

    // Then continuation lines stay references instead of becoming body text.
    const references = result.source.records.filter((record) => record.kind === 'reference')
    expect(references.map((record) => record.text)).toEqual([
      '1. Smith, J. (2020). First study.',
      'Continuation of the second entry.',
      '2. Doe, A. (2021). Second study.',
    ])
  })

  it('retains a figure caption with an original region crop', async () => {
    // Given a page with body text above a figure caption.
    const bytes = buildSamplePdf([{ lines: [
      'Body line one.', 'Body line two.', 'Body line three.', 'Body line four.',
      'Body line five.', 'Body line six.', 'Figure 1: Trend by group', 'Body after the figure.',
    ] }])

    // When the source is prepared.
    const result = await preparePaperTaskSource(bytes)
    if (!result.success) throw new Error('controlled figure document failed preparation')

    // Then the caption is translatable and its region is retained as an original asset.
    const figure = result.source.records.find((record) => record.kind === 'figure')
    expect(figure?.text).toContain('Figure 1')
    const asset = result.assets.find((candidate) => candidate.recordId === figure?.id)
    expect(asset?.availability).toBe('available')
    expect(asset?.bbox[3]).toBeGreaterThan(0)
  })

  it('returns cancellation for a pre-aborted request without reading PDF data', async () => {
    // Given a pre-aborted request.
    const controller = new AbortController()
    controller.abort()

    // When source preparation is called.
    const result = await preparePaperTaskSource(fixtureBytes(), controller.signal)

    // Then it returns the explicit cancellation outcome.
    expect(result).toEqual({ success: false, error: { code: 'cancelled' } })
  })

  it('returns a typed failure for empty and unreadable documents', async () => {
    // Given empty input and non-PDF bytes.
    const empty = await preparePaperTaskSource(new Uint8Array())
    const unreadable = await preparePaperTaskSource(new Uint8Array([1, 2, 3, 4]))

    // When the source boundary parses them.
    // Then each failure is explicit and does not expose parser internals.
    expect(empty).toEqual({ success: false, error: { code: 'empty-input' } })
    expect(unreadable).toEqual({ success: false, error: { code: 'invalid-pdf' } })
  })
})
