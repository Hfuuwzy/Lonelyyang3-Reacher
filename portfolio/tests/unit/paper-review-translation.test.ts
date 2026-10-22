import { describe, expect, it } from 'vitest'
import { paper29Groups, paper29Pages } from '../fixtures/paper-review-29'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { validateTranslations } from '../../server/utils/paper-review/translation'

describe('application translation coverage', () => {
  it.each(['missing', 'duplicate', 'unknown', 'blank', 'excluded', 'preserved'])('retains usable pairs and localizes %s translation records', async fault => {
    // Given a real source inventory and untrusted translation records.
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages) }))
    const eligible = source.units.slice(0, 6)
    const records = eligible.map(unit => ({ unitId: unit.id, chinese: '校准系统不会增加误差。' }))
    const first = records[0]
    if (!first) throw new Error('Missing fixture unit')
    switch (fault) {
      case 'missing': records.shift(); break
      case 'duplicate': records.push(first); break
      case 'unknown': records.push({ unitId: 'invented', chinese: '错误' }); break
      case 'blank': records[0] = { ...first, chinese: '  ' }; break
      case 'excluded': records.push({ unitId: source.units[8]?.id ?? '', chinese: '不应翻译' }); break
      case 'preserved': records.push({ unitId: source.units[6]?.id ?? '', chinese: '不应翻译' }); break
    }
    // When the application checks coverage by source ID, not model counts.
    const result = validateTranslations(source, JSON.stringify(records))
    // Then exactly the eligible rows remain; missing/unusable translations are null.
    expect(result.pairs).toHaveLength(6)
    expect(result.pairs[1]?.chinese).toBe('校准系统不会增加误差。')
    expect(result.gaps.length).toBeGreaterThan(0)
    if (['missing', 'duplicate', 'blank'].includes(fault)) {
      expect(result.pairs[0]?.chinese).toBeNull()
      expect(result.gaps[0]).toMatchObject({ unitIds: [first.unitId], spans: [{ readerPage: 1, lineIndex: 0, start: 0, end: 14 }] })
    }
  })
})
