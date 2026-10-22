import { describe, expect, it } from 'vitest'
import { extractPaperPages } from '../../server/utils/paper-review/pdf'
import { buildSamplePdf } from '../fixtures/generate-paper-review-sample.mjs'

describe('overprinted mathematical accents', () => {
  it('retains accented variables without marking readable prose ambiguous', async () => {
    const bytes = buildSamplePdf([{ lines: [{ runs: [
      { text: 'We sample w', x: 72 },
      { text: '`', x: 138 },
      { text: ' for testing.', x: 146 },
    ] }] }])
    const result = await extractPaperPages(bytes)
    if (!result.success) throw new Error('Fixture extraction failed')
    expect(result.pages[0]?.text).toContain('We sample w` for testing.')
    expect(result.pages[0]?.lines.some(line => line.ambiguous)).toBe(false)
  })
})
