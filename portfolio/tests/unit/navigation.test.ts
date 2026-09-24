import { describe, expect, it } from 'vitest'
import { getPortalNavItem, portalCategories, portalNavItems } from '../../app/data/navigation'

const navigationModule = await import('../../app/data/navigation')

describe('portal navigation data', () => {
  it('exposes only the planned runtime navigation API', () => {
    expect(Object.keys(navigationModule).sort()).toEqual([
      'getPortalNavItem',
      'portalCategories',
      'portalNavItems',
    ])
  })

  it('uses the planned runtime property names', () => {
    const expectedKeys = [
      'appearsOnHome',
      'descriptionJa',
      'descriptionZh',
      'englishLabel',
      'key',
      'labelJa',
      'labelZh',
      'path',
      'testId',
    ]

    for (const item of portalNavItems) {
      expect(Object.keys(item).sort()).toEqual(expectedKeys)
    }
  })

  it('keeps the spec route order and exposes eight home categories', () => {
    expect(portalNavItems.map(item => item.key)).toEqual([
      'home',
      'blog',
      'projects',
      'movies',
      'anime',
      'music',
      'tools',
      'life',
      'notes',
      'about',
    ])
    expect(portalCategories.map(item => item.key)).toEqual([
      'blog',
      'projects',
      'movies',
      'anime',
      'music',
      'tools',
      'life',
      'notes',
    ])
  })

  it('does not use emoji or icon data for structural navigation', () => {
    for (const item of portalNavItems) {
      expect(Object.keys(item)).not.toContain('icon')
      expect(item.labelZh).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(item.labelJa).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  it('returns the exact item for every planned route key', () => {
    for (const item of portalNavItems) {
      expect(getPortalNavItem(item.key)).toBe(item)
    }
  })
})
