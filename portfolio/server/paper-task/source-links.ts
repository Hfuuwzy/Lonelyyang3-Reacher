import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PaperTaskSourceLink } from '../../app/utils/paper-task-source-contract'

function viewportPoint(viewport: { readonly transform: readonly number[] }, x: number, y: number): readonly [number, number] {
  const a = viewport.transform[0] ?? 1
  const b = viewport.transform[1] ?? 0
  const c = viewport.transform[2] ?? 0
  const d = viewport.transform[3] ?? 1
  const e = viewport.transform[4] ?? 0
  const f = viewport.transform[5] ?? 0
  return [a * x + c * y + e, b * x + d * y + f]
}

async function originalDestinationLink(
  document: PDFDocumentProxy,
  destination: string | unknown[] | null,
): Promise<PaperTaskSourceLink | undefined> {
  const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination
  const pageReference = resolved?.[0]
  if (pageReference === undefined || pageReference === null || typeof pageReference !== 'object') return undefined
  const pageIndex = await document.getPageIndex(pageReference)
  return pageIndex >= 0 && pageIndex < document.numPages
    ? { kind: 'original', url: `pdf://${pageIndex + 1}` }
    : undefined
}

export async function linksFor(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
  bbox: readonly [number, number, number, number],
): Promise<readonly PaperTaskSourceLink[]> {
  const [x, y, width, height] = bbox
  const viewport = page.getViewport({ scale: 1 })
  const annotations = await page.getAnnotations()
  const links: PaperTaskSourceLink[] = []
  for (const annotation of annotations) {
    const rect = annotation.rect
    if (!Array.isArray(rect) || rect.length !== 4) continue
    const first = viewportPoint(viewport, rect[0] ?? 0, rect[1] ?? 0)
    const second = viewportPoint(viewport, rect[2] ?? 0, rect[3] ?? 0)
    const [left, bottom] = first
    const [right, top] = second
    if (!(Math.min(left, right) < x + width && Math.max(left, right) > x
      && Math.min(bottom, top) < y + height && Math.max(bottom, top) > y)) continue
    if (typeof annotation.url === 'string') {
      try {
        const parsed = new URL(annotation.url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          links.push({ kind: 'reference', url: parsed.href })
        }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    } else {
      const original = await originalDestinationLink(document, annotation.dest)
      if (original !== undefined) links.push(original)
    }
  }
  return links
}
