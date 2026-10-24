import type { PaperTaskReaderHeading } from './paper-task-markdown'

export interface PaperTaskReaderTocItem extends PaperTaskReaderHeading {
  readonly children: PaperTaskReaderTocItem[]
}

/** Nest h3 entries under the preceding h2 while preserving the renderer's ids and order. */
export function buildPaperTaskReaderToc(
  headings: readonly PaperTaskReaderHeading[],
): PaperTaskReaderTocItem[] {
  const items: PaperTaskReaderTocItem[] = []
  let currentSection: PaperTaskReaderTocItem | undefined

  for (const heading of headings) {
    const item: PaperTaskReaderTocItem = { ...heading, children: [] }
    if (heading.depth === 3 && currentSection !== undefined) {
      currentSection.children.push(item)
      continue
    }

    items.push(item)
    currentSection = heading.depth === 2 ? item : undefined
  }

  return items
}
