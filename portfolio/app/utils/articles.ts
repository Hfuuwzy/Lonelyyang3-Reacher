export interface ArticleListItem {
  readonly path: string
  readonly title?: string
  readonly description?: string
  readonly date?: string | Date
  readonly category?: string
  readonly tags?: readonly string[]
  readonly cover?: string
}

export interface SplitFeed<T> {
  readonly primary: readonly T[]
  readonly secondary: readonly T[]
  readonly combined: readonly T[]
}

const articleDateLocales = {
  zh: 'zh-CN',
  ja: 'ja-JP',
} as const satisfies Readonly<Record<'zh' | 'ja', string>>

export function getArticleTimestamp(date: string | Date | undefined): number {
  if (date === undefined) {
    return Number.NEGATIVE_INFINITY
  }

  const timestamp = date instanceof Date ? date.getTime() : Date.parse(date)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

export function sortArticlesByDateDesc<T extends ArticleListItem>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) => getArticleTimestamp(right.date) - getArticleTimestamp(left.date))
}

export function splitEvenOddFeed<T extends ArticleListItem>(items: readonly T[]): SplitFeed<T> {
  const primary: T[] = []
  const secondary: T[] = []

  items.forEach((item, index) => {
    if (index % 2 === 0) {
      primary.push(item)
      return
    }

    secondary.push(item)
  })

  return {
    primary,
    secondary,
    combined: [...items],
  }
}

export function formatDisplayDate(date: string | Date | undefined, locale: 'zh' | 'ja'): string {
  const timestamp = getArticleTimestamp(date)
  if (timestamp === Number.NEGATIVE_INFINITY) {
    return ''
  }

  return new Intl.DateTimeFormat(articleDateLocales[locale], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(timestamp)
}
