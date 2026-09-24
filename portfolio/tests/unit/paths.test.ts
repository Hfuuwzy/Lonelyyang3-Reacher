import { describe, expect, it } from 'vitest'
import {
  canonicalContentPathFromRoute,
  DEFAULT_LOCALE,
  JA_PREFIX,
  localizedPathFromCanonical,
  slugFromBlogPath,
} from '../../app/utils/paths'

const pathsModule = await import('../../app/utils/paths')

describe('locale-aware canonical content paths', () => {
  it('exposes only the planned runtime path API', () => {
    expect(Object.keys(pathsModule).sort()).toEqual([
      'DEFAULT_LOCALE',
      'JA_PREFIX',
      'canonicalContentPathFromRoute',
      'localizedPathFromCanonical',
      'slugFromBlogPath',
    ])
  })

  it('keeps default-locale content paths unchanged', () => {
    expect(canonicalContentPathFromRoute('/blog/mysql-basics')).toBe('/blog/mysql-basics')
  })

  it('strips the Japanese locale prefix before Nuxt Content lookup', () => {
    expect(canonicalContentPathFromRoute('/ja/blog/mysql-basics')).toBe('/blog/mysql-basics')
  })

  it('normalizes the Japanese homepage to the default canonical path', () => {
    expect(canonicalContentPathFromRoute('/ja')).toBe('/')
    expect(canonicalContentPathFromRoute('/ja/')).toBe('/')
  })

  it('extracts a slug from a canonical blog path', () => {
    expect(slugFromBlogPath('/blog/linux-commands')).toBe('linux-commands')
  })

  it('exposes the planned locale constants', () => {
    expect(DEFAULT_LOCALE).toBe('zh')
    expect(JA_PREFIX).toBe('/ja')
  })

  it('delegates a canonical path to the supplied locale callback', () => {
    const receivedPaths: string[] = []
    const localePath = (path: string): string => {
      receivedPaths.push(path)
      return `/ja${path}`
    }

    expect(localizedPathFromCanonical('/blog/mysql-basics', localePath)).toBe('/ja/blog/mysql-basics')
    expect(receivedPaths).toEqual(['/blog/mysql-basics'])
  })
})
