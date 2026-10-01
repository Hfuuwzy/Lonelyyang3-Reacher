import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ExtractedPaperPage } from './pdf'

/** Largest line we will consider as a single heading. */
const HEADING_MAX_LENGTH = 80
/** Numbered academic heading, e.g. "1 Introduction", "2.3 Methods". */
const HEADING_PATTERN = /^\d+(\.\d+)*\.?\s+\S/

/** A heading candidate is an exact, short, structurally numbered page line. */
export function isPdfHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) {
    return false
  }
  return HEADING_PATTERN.test(trimmed)
}

/** Structural shape drawn from a page's `getTextContent()` items. */
interface TextRunItem {
  readonly str?: unknown
  readonly width?: unknown
  readonly transform?: readonly unknown[]
}

/** Narrow a `getTextContent()` item to a text run (one carrying a `str`). */
function isTextRun(item: object): item is TextRunItem {
  return 'str' in item && typeof item.str === 'string'
}

interface PlacedRun {
  readonly x: number
  readonly width: number
  readonly text: string
}

/**
 * Reconstruct visual lines from a page's text items. Items carrying a `str`
 * field (text runs) are grouped by vertical position (`transform[5]`, larger y
 * = higher on the page) and joined left-to-right (`transform[4]`) within a
 * line.
 */
function reconstructLines(items: readonly TextRunItem[]): string[] {
  const groups = new Map<number, PlacedRun[]>()
  for (const item of items) {
    const transform = item.transform
    if (typeof item.str !== 'string' || !transform) {
      continue
    }
    const rawY = transform[5]
    const rawX = transform[4]
    if (typeof rawY !== 'number') {
      continue
    }
    const x = typeof rawX === 'number' ? rawX : 0
    const width = typeof item.width === 'number' ? item.width : 0
    const y = Math.round(rawY)
    const placed = [...(groups.get(y) ?? [])]
    placed.push({ x, width, text: item.str })
    groups.set(y, placed)
  }
  const orderedY = [...groups.keys()].sort((a, b) => b - a)
  return orderedY
    .map((y) => {
      const runs = [...(groups.get(y) ?? [])].sort((a, b) => a.x - b.x)
      let line = ''
      for (const [index, run] of runs.entries()) {
        line += run.text
        const next = runs[index + 1]
        // Insert a single space only when the adjacent runs have a real
        // horizontal gap and neither side already supplies whitespace.
        if (
          next !== undefined &&
          next.x - (run.x + run.width) > 0 &&
          !/\s$/.test(run.text) &&
          !/^\s/.test(next.text)
        ) {
          line += ' '
        }
      }
      return line
    })
    .filter((line) => line.trim().length > 0)
}

export async function readPage(
  document: PDFDocumentProxy,
  readerPage: number,
): Promise<ExtractedPaperPage> {
  const page = await document.getPage(readerPage)
  const content = await page.getTextContent()
  const runs: TextRunItem[] = []
  for (const item of content.items) {
    if (isTextRun(item)) {
      runs.push(item)
    }
  }
  const lines = reconstructLines(runs)
  return {
    readerPage,
    textRuns: runs.filter(run => typeof run.str === 'string' && run.str.trim() !== '').map(run => ({
      text: typeof run.str === 'string' ? run.str : '',
      x: typeof run.transform?.[4] === 'number' ? run.transform[4] : Number.NaN,
      y: typeof run.transform?.[5] === 'number' ? run.transform[5] : Number.NaN,
      width: typeof run.width === 'number' ? run.width : Number.NaN,
      horizontal: run.transform?.[1] === 0 && run.transform?.[2] === 0,
    })),
    lines: lines.map((text) => ({ text, isHeading: isPdfHeadingLine(text) })),
    headings: lines.filter(isPdfHeadingLine),
    text: lines.join('\n'),
  }
}
