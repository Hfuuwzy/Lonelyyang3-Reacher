import { describe, expect, it } from 'vitest'
import { extractPaperPages } from '../../server/utils/paper-review/pdf'
import { buildColumnPaperPdf, expectedColumnPaperLines } from '../fixtures/generate-paper-review-columns.mjs'
import { buildUnevenColumnPdf, expectedUnevenColumnLines } from '../fixtures/generate-paper-review-uneven-columns.mjs'
import { buildNarrowGutterPdf, expectedNarrowGutterLines, buildCodebertTablePdf, expectedCodebertTableLines } from '../fixtures/generate-paper-review-codebert.mjs'

async function extractLines(bytes: Uint8Array): Promise<string[]> {
  const result = await extractPaperPages(bytes)
  expect(result.success).toBe(true)
  if (!result.success) throw new Error('fixture extraction failed')
  return result.pages[0]!.lines.map((line) => line.text)
}

const normalized = (text: string): string => text.trim().replace(/\s+/g, ' ')

describe('region-aware one/two-column reconstruction', () => {
  it('reconstructs the shared-baseline two-column fixture: nothing lost, left column read before right', async () => {
    const lines = await extractLines(buildColumnPaperPdf())
    // pdfjs collapses tables' internal whitespace ("Method    Accuracy") to a
    // single space and headers may resolve as full-width or column-local, so
    // assert coverage and reading order rather than an unreachable exact array.
    expect(lines.length).toBe(expectedColumnPaperLines.length)
    const actual = lines.map(normalized)
    for (const expectedLine of expectedColumnPaperLines) {
      expect(actual).toContain(normalized(expectedLine))
    }
    const leftIdx = actual.indexOf(normalized('Two-column text keeps lines short'))
    const rightIdx = actual.indexOf(normalized('Right-column prose is independent'))
    expect(leftIdx).toBeGreaterThan(-1)
    expect(rightIdx).toBeGreaterThan(leftIdx)
  })

  it('recovers columns from rows that share no baseline pair (asymmetric baselines)', async () => {
    const lines = await extractLines(buildUnevenColumnPdf())
    expect(lines).toEqual(expectedUnevenColumnLines)
  })

  it('separates a narrow 15px gutter that the old fixed 40px gap could not detect', async () => {
    const lines = await extractLines(buildNarrowGutterPdf())
    expect(lines).toEqual(expectedNarrowGutterLines)
  })

  it('keeps a full-width table row-major while prose columns stay column local', async () => {
    const lines = await extractLines(buildCodebertTablePdf())
    expect(lines).toEqual(expectedCodebertTableLines)
  })

  it('rejects false headings while recognising real numbered headings on real extracted lines', async () => {
    const result = await extractPaperPages(buildNarrowGutterPdf())
    if (!result.success) throw new Error('fixture extraction failed')
    expect(result.pages[0]!.headings).toEqual(['1 Introduction'])
  })
})