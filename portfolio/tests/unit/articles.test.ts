import { describe, expect, it } from 'vitest'
import {
  formatDisplayDate,
  getArticleTimestamp,
  sortArticlesByDateDesc,
  splitEvenOddFeed,
} from '../../app/utils/articles'

const articlesModule = await import('../../app/utils/articles')

const posts = [
  { path: '/blog/mysql-basics', title: 'MySQL', date: '2023-04-20' },
  { path: '/blog/linux-commands', title: 'Linux', date: '2023-06-10' },
  { path: '/blog/ai-thinking', title: 'AI', date: '2023-05-15' },
] as const

describe('article feed helpers', () => {
  it('exposes only the planned runtime article API', () => {
    expect(Object.keys(articlesModule).sort()).toEqual([
      'formatDisplayDate',
      'getArticleTimestamp',
      'sortArticlesByDateDesc',
      'splitEvenOddFeed',
    ])
  })

  it('sorts by date descending without mutating the source array', () => {
    const sorted = sortArticlesByDateDesc(posts)

    expect(sorted.map(post => post.path)).toEqual([
      '/blog/linux-commands',
      '/blog/ai-thinking',
      '/blog/mysql-basics',
    ])
    expect(posts.map(post => post.path)).toEqual([
      '/blog/mysql-basics',
      '/blog/linux-commands',
      '/blog/ai-thinking',
    ])
  })

  it('splits a sorted feed into even primary and odd secondary columns', () => {
    const sorted = sortArticlesByDateDesc(posts)
    const split = splitEvenOddFeed(sorted)

    expect(split.primary.map(post => post.path)).toEqual([
      '/blog/linux-commands',
      '/blog/mysql-basics',
    ])
    expect(split.secondary.map(post => post.path)).toEqual([
      '/blog/ai-thinking',
    ])
    expect(split.combined.map(post => post.path)).toEqual([
      '/blog/linux-commands',
      '/blog/ai-thinking',
      '/blog/mysql-basics',
    ])
  })

  it('supports Date timestamps and maps missing or invalid dates to negative infinity', () => {
    const date = new Date('2023-06-10T00:00:00.000Z')

    expect(getArticleTimestamp(date)).toBe(date.getTime())
    expect(getArticleTimestamp(undefined)).toBe(Number.NEGATIVE_INFINITY)
    expect(getArticleTimestamp('not-a-date')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('sorts Date values and leaves missing or invalid dates last without mutation', () => {
    const mixedPosts = [
      { path: '/missing' },
      { path: '/date-object', date: new Date('2024-02-01T00:00:00.000Z') },
      { path: '/invalid', date: 'not-a-date' },
      { path: '/date-string', date: '2024-03-01' },
    ] as const

    const sorted = sortArticlesByDateDesc(mixedPosts)

    expect(sorted.map(post => post.path)).toEqual([
      '/date-string',
      '/date-object',
      '/missing',
      '/invalid',
    ])
    expect(mixedPosts.map(post => post.path)).toEqual([
      '/missing',
      '/date-object',
      '/invalid',
      '/date-string',
    ])
  })

  it('formats string and Date inputs by locale and returns empty text for missing or invalid dates', () => {
    const date = new Date('2023-06-10T00:00:00.000Z')

    expect(formatDisplayDate('2023-06-10', 'zh')).toBe('2023年6月10日')
    expect(formatDisplayDate(date, 'ja')).toBe('2023年6月10日')
    expect(formatDisplayDate(undefined, 'zh')).toBe('')
    expect(formatDisplayDate('not-a-date', 'ja')).toBe('')
  })
})
