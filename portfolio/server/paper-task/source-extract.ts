import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {
  PaperTaskSource,
  PaperTaskSourceKind,
  PaperTaskSourceRecord,
} from '../../app/utils/paper-task-source-contract'
import { linksFor } from './source-links'

type TextRun = {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly horizontal: boolean
}

type Line = {
  readonly text: string
  readonly runs: readonly TextRun[]
  readonly bbox: readonly [number, number, number, number]
  readonly kind: PaperTaskSourceKind
  readonly state: 'present' | 'ambiguous'
}

function isTextItem(item: unknown): item is {
  readonly str: string
  readonly transform: readonly number[]
  readonly width: number
  readonly height: number
} {
  return typeof item === 'object' && item !== null && 'str' in item && typeof item.str === 'string'
    && 'transform' in item && Array.isArray(item.transform)
    && 'width' in item && typeof item.width === 'number'
    && 'height' in item && typeof item.height === 'number'
}

function classify(text: string, y: number, inReferences: boolean): PaperTaskSourceKind {
  const line = text.trim()
  if (/^(?:appendix|appendices)\b/i.test(line)) return 'appendix'
  if (/^(?:references|bibliography|works cited)$/i.test(line)) return 'heading'
  if (inReferences) return 'reference'
  if (/^algorithm\s+\d*\s*[:.]/i.test(line)) return 'algorithm'
  if (/^table\s+\d*\s*[:.]/i.test(line)) return 'table'
  if (/^(?:figure|fig\.)\s*\d{1,4}\s*[.:|]/i.test(line)) return 'figure'
  if (/\([^)]*\d+[^)]*\)\s*$/.test(line) && /[=<>±×÷∑∫√^]/u.test(line)) return 'formula'
  if (y < 90 && /^(?:\d+|[*†‡])\s/.test(line)) return 'footnote'
  if (/^(?:\d+(?:\.\d+)*\.?\s+[A-Z]|appendix\s+[A-Z])/i.test(line)) return 'heading'
  if (/[=<>±×÷∑∫√^]/u.test(line) && line.length < 180) return 'formula'
  return 'body'
}

async function linesForPage(page: PDFPageProxy, initialInReferences = false): Promise<{ readonly lines: readonly Line[]; readonly inReferences: boolean }> {
  const content = await page.getTextContent()
  const runs: TextRun[] = []
  for (const item of content.items) {
    if (!isTextItem(item) || item.str.trim().length === 0) continue
    runs.push({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width,
      height: item.height,
      horizontal: (item.transform[1] ?? 1) === 0 && (item.transform[2] ?? 0) === 0,
    })
  }
  const rows = new Map<number, TextRun[]>()
  for (const run of runs) {
    const baseline = Math.round(run.y)
    rows.set(baseline, [...(rows.get(baseline) ?? []), run])
  }
  const ordered = [...rows.entries()].sort(([a], [b]) => b - a)
  const recurringStarts = new Map<number, number>()
  for (const [, row] of ordered) {
    if (row.length < 2) continue
    for (const run of row) {
      const start = Math.round(run.x)
      recurringStarts.set(start, (recurringStarts.get(start) ?? 0) + 1)
    }
  }
  const gridRows = ordered.filter(([, row]) =>
    row.filter((run) => (recurringStarts.get(Math.round(run.x)) ?? 0) >= 2).length >= 2,
  )
  const viewport = page.getViewport({ scale: 1 })
  const pageHeight = viewport.height
  const tableCaption = ordered.findIndex(([, row]) => /^table\s+\d*\s*[:.]/i.test(row.map((run) => run.text).join(' ').trim()))
  const captionBaseline = tableCaption < 0 ? undefined : ordered[tableCaption]?.[0]
  const nextCaptionBaseline = ordered.slice(tableCaption + 1).find(([, row]) => /^table\s+\d*\s*[:.]/i.test(row.map((run) => run.text).join(' ').trim()))?.[0]
  const captionedGridRows = captionBaseline === undefined ? [] : gridRows.filter(([baseline]) =>
    baseline < captionBaseline && captionBaseline - baseline <= 180 && (nextCaptionBaseline === undefined || baseline > nextCaptionBaseline),
  )
  const captionRow = tableCaption < 0 ? undefined : ordered[tableCaption]?.[1]
  const captionTop = captionBaseline === undefined || captionRow === undefined
    ? 0
    : pageHeight - captionBaseline - Math.max(...captionRow.map((run) => run.height))
  const gridTop = captionedGridRows.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...captionedGridRows.map(([y]) => y))
  const gridBottom = captionedGridRows.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...captionedGridRows.map(([y]) => y))
  const gridBounds = captionedGridRows.length === 0 ? undefined : [
    Math.max(0, Math.min(...captionedGridRows.flatMap(([, row]) => row.map((run) => run.x))) - 12),
    Math.max(0, captionTop - 16),
    Math.max(...captionedGridRows.flatMap(([, row]) => row.map((run) => run.x + run.width)))
      - Math.min(...captionedGridRows.flatMap(([, row]) => row.map((run) => run.x))) + 24,
    Math.min(pageHeight, pageHeight - gridBottom + 52) - Math.max(0, captionTop - 16),
  ] as const
  let inReferences = initialInReferences
  let inAlgorithm = false
  let previousContextLine: Line | undefined
  let unsupportedTable = false
  const lines: Line[] = []
  for (const [baseline, row] of ordered) {
    const orderedRuns = [...row].sort((a, b) => a.x - b.x)
    const text = orderedRuns.map((run) => run.text).join(' ').trim()
    const tableCaptionLine = /^table\s+\d*\s*[:.]/i.test(text)
    if (tableCaptionLine) unsupportedTable = baseline !== captionBaseline
    if (/^(?:references|bibliography|works cited)$/i.test(text)) inReferences = true
    if (/^(?:appendix|appendices)\b/i.test(text)) inReferences = false
    if (/^algorithm\s+\d*\s*[:.]/i.test(text)) inAlgorithm = true
    if (!/^\d+[.)]\s/.test(text)
      && /^(?:\d+(?:\.\d+)*\.?\s+[A-Z]|appendix\s+[A-Z]|references|bibliography)$/i.test(text)) {
      inAlgorithm = false
    }
    const left = Math.min(...orderedRuns.map((run) => run.x))
    const top = pageHeight - baseline - Math.max(...orderedRuns.map((run) => run.height))
    const right = Math.max(...orderedRuns.map((run) => run.x + run.width))
    const bottom = pageHeight - baseline + 2
    const overlapping = orderedRuns.some((run, index) => {
      const next = orderedRuns[index + 1]
      return !run.horizontal || (next !== undefined && next.x < run.x + run.width - 1)
    })
    const inTableBand = gridBounds !== undefined && (
      (baseline <= gridTop && baseline >= gridBottom)
      || (/^notes?\s*:/i.test(text) && baseline < gridBottom && gridBottom - baseline <= 44)
    )
    const bbox: readonly [number, number, number, number] = inTableBand && gridBounds !== undefined
      ? gridBounds
      : [Math.max(0, left - 4), Math.max(0, top - 4), right - left + 8, bottom - top + 8]
    const captionHasGridRows = gridRows.some(([gridBaseline]) =>
      gridBaseline < baseline && baseline - gridBaseline <= 180,
    )
    const unsupportedTableRow = unsupportedTable && (tableCaptionLine || gridRows.some(([gridBaseline]) => gridBaseline === baseline))
    const captionOnlyTable = tableCaptionLine && (!captionHasGridRows || unsupportedTable)
    const formulaContext = classify(text, baseline, inReferences) === 'formula'
      && previousContextLine !== undefined && previousContextLine.kind !== 'table'
      && previousContextLine.kind !== 'algorithm'
      ? previousContextLine.bbox
      : undefined
    const cropBbox = formulaContext === undefined ? bbox : [
      Math.min(bbox[0], formulaContext[0]), Math.min(bbox[1], formulaContext[1]),
      Math.max(bbox[0] + bbox[2], formulaContext[0] + formulaContext[2]) - Math.min(bbox[0], formulaContext[0]),
      Math.max(bbox[1] + bbox[3], formulaContext[1] + formulaContext[3]) - Math.min(bbox[1], formulaContext[1]),
    ] as const
    const kind = inTableBand || unsupportedTableRow ? 'table' : inAlgorithm && /^\d+[.)]/.test(text)
      ? 'algorithm' : classify(text, baseline, inReferences)
    const retainedBbox = kind === 'figure'
      ? [
          Math.max(0, left - 36),
          Math.max(0, top - 320),
          Math.min(viewport.width, right + 36) - Math.max(0, left - 36),
          Math.min(top, 320),
        ] as const
      : cropBbox
    const line: Line = {
      text,
      runs: orderedRuns,
      bbox: retainedBbox,
      kind,
      state: captionOnlyTable || unsupportedTableRow || overlapping || (gridBounds === undefined && gridRows.some(([gridBaseline]) => gridBaseline === baseline))
        ? 'ambiguous' : 'present',
    }
    lines.push(line)
    if (line.kind !== 'heading' && line.kind !== 'appendix') previousContextLine = line
  }
  const consolidated: Line[] = []
  for (const line of lines) {
    const previous = consolidated.at(-1)
    if (previous === undefined || previous.kind !== line.kind || (line.kind !== 'table' && line.kind !== 'algorithm')) {
      consolidated.push(line)
      continue
    }
    const [previousX, previousY, previousWidth, previousHeight] = previous.bbox
    const [lineX, lineY, lineWidth, lineHeight] = line.bbox
    const left = Math.min(previousX, lineX)
    const top = Math.min(previousY, lineY)
    const right = Math.max(previousX + previousWidth, lineX + lineWidth)
    const bottom = Math.max(previousY + previousHeight, lineY + lineHeight)
    consolidated[consolidated.length - 1] = {
      text: `${previous.text}\n${line.text}`,
      runs: [...previous.runs, ...line.runs],
      bbox: [left, top, right - left, bottom - top],
      kind: line.kind,
      state: previous.state === 'ambiguous' || line.state === 'ambiguous' ? 'ambiguous' : 'present',
    }
  }
  const finalized = consolidated.map((line) => {
    if (line.kind !== 'table' || line.state !== 'present') return line
    const left = Math.min(...line.runs.map((run) => run.x)) - 4
    const top = pageHeight - Math.max(...line.runs.map((run) => run.y + run.height)) - 4
    const right = Math.max(...line.runs.map((run) => run.x + run.width)) + 4
    const bottom = pageHeight - Math.min(...line.runs.map((run) => run.y)) + 6
    return { ...line, bbox: [left, top, right - left, bottom - top] as const }
  })
  return { lines: finalized, inReferences }
}

export async function extractSourceRecords(document: PDFDocumentProxy): Promise<PaperTaskSource> {
  const records: PaperTaskSourceRecord[] = []
  let sectionId: string | null = null
  let context = ''
  let incomplete = false
  let needsConfirmation = false
  let inReferences = false
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const pageLines = await linesForPage(page, inReferences)
    inReferences = pageLines.inReferences
    const lines = pageLines.lines
    if (lines.length === 0) {
      incomplete = true
      records.push({
        id: `p${pageNumber}-r0`, order: records.length, kind: 'gap', text: '', state: 'unrecovered',
        page: pageNumber, bbox: [0, 0, page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height],
        sectionId, context: 'Page contains no recoverable selectable text.', links: [],
      })
      continue
    }
    for (const line of lines) {
      if (line.kind === 'heading' || line.kind === 'appendix') {
        sectionId = `p${pageNumber}-r${records.length}`
        context = line.text
      }
      const links = await linksFor(document, page, line.bbox)
      records.push({
        id: `p${pageNumber}-r${records.length}`, order: records.length, kind: line.kind, text: line.text,
        state: line.state, page: pageNumber, bbox: line.bbox, sectionId, context, links,
      })
       if (line.state === 'ambiguous') needsConfirmation = true
       if (line.kind === 'table' && line.state === 'ambiguous') incomplete = true
      if (line.kind !== 'heading' && line.kind !== 'appendix') context = line.text
    }
  }
  return {
    status: incomplete ? 'incomplete' : needsConfirmation ? 'needs-confirmation' : 'complete',
    pageCount: document.numPages,
    records,
  }
}
