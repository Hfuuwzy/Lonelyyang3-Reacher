import { readFileSync } from 'node:fs'
import { extractPaperPages, type ExtractedPaperPage } from '../../server/utils/paper-review/pdf'

export function paper29Bytes(): Uint8Array {
  return readFileSync(new URL('./paper-review-29.pdf', import.meta.url))
}

export async function paper29Pages(): Promise<readonly ExtractedPaperPage[]> {
  const extracted = await extractPaperPages(paper29Bytes())
  if (!extracted.success) throw new Error('Fixed #29 PDF extraction failed')
  return extracted.pages
}

export function paper29Groups(pages: readonly ExtractedPaperPage[]) {
  const span = (readerPage: number, lineIndex: number) => ({
    readerPage, lineIndex, start: 0,
    end: pages.find(page => page.readerPage === readerPage)?.lines[lineIndex]?.text.length ?? 0,
  })
  return [
    { kind: 'heading', spans: [span(1, 0)] },
    { kind: 'paragraph', spans: [span(1, 1), span(1, 2)] },
    { kind: 'paragraph', spans: [span(1, 3), span(2, 0)] },
    { kind: 'heading', spans: [span(2, 1)] },
    { kind: 'caption', spans: [span(2, 2)], mediaReaderPages: [2] },
    { kind: 'caption', spans: [span(2, 3)], mediaReaderPages: [2] },
    { kind: 'preserved-original', spans: [span(2, 4), span(2, 5)], reason: 'table-content' },
    { kind: 'preserved-original', spans: [span(2, 6)], reason: 'formula' },
    { kind: 'excluded', spans: [span(2, 7), span(2, 8)], reason: 'bibliography' },
    { kind: 'excluded', spans: [span(2, 9), span(2, 10)], reason: 'appendix' },
  ]
}
