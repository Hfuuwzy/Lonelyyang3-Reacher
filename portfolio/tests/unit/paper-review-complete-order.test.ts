import { describe, expect, it } from 'vitest'
import { extractPaperPages } from '../../server/utils/paper-review/pdf'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { buildColumnPaperPdf, expectedColumnPaperLines } from '../fixtures/generate-paper-review-columns.mjs'

const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ')

describe('complete two-column reading order', () => {
  it('preserves the complete independently specified source sequence', async () => {
    const extracted = await extractPaperPages(buildColumnPaperPdf())
    if (!extracted.success) throw new Error('Fixture extraction failed')
    const page = extracted.pages[0]
    if (page === undefined) throw new Error('Fixture page missing')

    expect(page.lines.map(line => normalize(line.text))).toEqual(expectedColumnPaperLines.map(normalize))
  })

  it('keeps right-column prose before the full-width bibliography eligible for translation', async () => {
    const extracted = await extractPaperPages(buildColumnPaperPdf())
    if (!extracted.success) throw new Error('Fixture extraction failed')
    const inventory = validateSourceInventory(extracted.pages, '[]')
    const prose = inventory.source.units.find(unit => unit.original.includes('Right-column prose is independent'))

    expect(prose?.kind).toBe('paragraph')
  })
})
