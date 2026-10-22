import { describe, expect, it } from 'vitest'
import { MAX_UNITS_PER_BATCH, partitionIds, partitionPagesByText } from '../../server/paper-review-internal/batching'

describe('partitionIds bounded serialized batches', () => {
  it('splits by unit count exactly at the unit limit', () => {
    const items = Array.from({ length: MAX_UNITS_PER_BATCH + 1 }, (_, index) => ({ id: `u${index}`, text: 'x' }))
    const batches = partitionIds(items)
    expect(batches.map(batch => batch.length)).toEqual([MAX_UNITS_PER_BATCH, 1])
  })

  it('budgets by serialized characters, not raw text length', () => {
    // Two records whose raw text sums under the budget, but whose JSON-escaped
    // serialized size (quotes double) exceeds it, cannot share one batch.
    const quoted = (index: number) => ({ id: `u${index}`, text: '"'.repeat(2950) })
    const batches = partitionIds([quoted(1), quoted(2)], MAX_UNITS_PER_BATCH, 6000)
    expect(batches.map(batch => batch.length)).toEqual([1, 1])
  })

  it('sends a single oversized record whole in its own batch rather than truncating', () => {
    const batches = partitionIds([{ id: 'huge', text: 'z'.repeat(8000) }], MAX_UNITS_PER_BATCH, 3000)
    expect(batches).toEqual([['huge']])
  })
})

describe('partitionPagesByText bounded report chunks', () => {
  it('splits pages by the char budget and keeps a single oversized page whole', () => {
    const smallPage = { text: 'short' }
    const bigPage = { text: 'x'.repeat(7000) }
    const chunks = partitionPagesByText([smallPage, bigPage, smallPage], 6000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toHaveLength(3)
    expect(chunks.find(chunk => chunk.includes(bigPage))).toEqual([bigPage])
  })

  it('preserves order and never drops items', () => {
    const pages = Array.from({ length: 30 }, (_, index) => ({ text: `page ${index} `.repeat(20) }))
    const chunks = partitionPagesByText(pages, 2000)
    expect(chunks.flat().map(page => page.text)).toEqual(pages.map(page => page.text))
  })
})