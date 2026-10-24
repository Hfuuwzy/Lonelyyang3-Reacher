export interface ArticleTocLink {
  readonly id: string
  readonly text: string
  readonly children?: readonly ArticleTocLink[]
}

export function flattenArticleToc(links: readonly ArticleTocLink[]): ArticleTocLink[] {
  return links.flatMap(link => [link, ...flattenArticleToc(link.children ?? [])])
}
