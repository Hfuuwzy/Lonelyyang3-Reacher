import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ExtractedPaperPage, ExtractedPaperLine } from './pdf'

/** Largest line we will consider as a single heading. */
const HEADING_MAX_LENGTH = 80
/**
 * Numbered academic heading, e.g. "1 Introduction", "2.3 Methods". The token
 * after the number must start with a letter so bare numeric rows and author
 * markers never become headings, and a bare 4-digit year followed by ". " is
 * rejected as a dated reference entry rather than a section number.
 */
const HEADING_PATTERN = /^\d+(\.\d+)*\.?\s+[A-Za-z]/
/** A dated reference entry such as "2019. code2seq: ..." is not a heading. */
const YEAR_PREFIX = /^\d{4}\.\s/

/** A heading candidate is an exact, short, structurally numbered page line. */
export function isPdfHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) {
    return false
  }
  return HEADING_PATTERN.test(trimmed) && !YEAR_PREFIX.test(trimmed)
}

/** Structural shape drawn from a page's `getTextContent()` items. */
interface TextRunItem {
  readonly str?: unknown
  readonly width?: unknown
  readonly transform?: readonly unknown[]
  readonly height?: unknown
  readonly fontName?: unknown
}

/** Narrow a `getTextContent()` item to a text run (one carrying a `str`). */
function isTextRun(item: object): item is TextRunItem {
  return 'str' in item && typeof item.str === 'string'
}

interface PlacedRun {
  readonly x: number
  readonly width: number
  readonly text: string
  readonly font?: string
  readonly height?: number
  readonly horizontal: boolean
}

interface Row {
  readonly y: number
  readonly runs: readonly PlacedRun[]
}

/** One reconstructed visual line with the geometry that produced it. */
export interface ReconstructedLine {
  readonly text: string
  /** Rounded baseline y (larger = higher on the page). */
  readonly baselineY: number
  /** Region index in x order for a column-row, or undefined for a full-width line. */
  readonly column?: number
  /** True when this baseline's runs overlap, so the reading order is ambiguous. */
  readonly ambiguous?: boolean
  /**
   * Recognized content kind carried through to the candidate layer so
   * unpreservable/localized geometry can stay readable instead of being
   * mislabelled as a table or a column split.
   */
  readonly recognized?: 'table' | 'formula' | 'code'
}

/** True when a run carries visible (non-whitespace) text. */
function isVisible(run: PlacedRun): boolean {
  return run.text.trim().length > 0
}

/** True when a run is laid out on a horizontal baseline (not rotated text). */
function isHorizontal(run: PlacedRun): boolean {
  return run.horizontal
}

function rowVisible(runs: readonly PlacedRun[]): PlacedRun[] {
  return runs.filter((run) => isVisible(run) && isHorizontal(run))
}

/** True when a run reads as a table cell (numeric or a bare token). */
const NUMERIC_TOKEN = /^[\d.,%\u2212\-]+$/
function isNumericToken(text: string): boolean {
  const t = text.trim()
  return t !== '' && NUMERIC_TOKEN.test(t)
}

const GAP_TOLERANCE = 6

/**
 * The x-union coverage of a row's runs as a single merged interval, when the
 * runs form one continuous span (no gap larger than GAP_TOLERANCE). A full-width
 * band (a heading or a full-width table) is such a single continuous span that
 * covers a large fraction of the page content width.
 */
function continuousSpan(row: Row): { readonly start: number; readonly end: number } | undefined {
  const vis = rowVisible(row.runs)
  if (vis.length === 0) {
    return undefined
  }
  const sorted = [...vis].sort((a, b) => a.x - b.x)
  let start = sorted[0]!.x
  let end = sorted[0]!.x + sorted[0]!.width
  for (const run of sorted.slice(1)) {
    if (run.x - end > GAP_TOLERANCE) {
      return undefined
    }
    end = Math.max(end, run.x + run.width)
  }
  return { start, end }
}

/** True when a row is one continuous full-width band (≥ 60% of content width). */
function isFullWidthBand(row: Row, contentLeft: number, contentRight: number): boolean {
  const content = contentRight - contentLeft
  const span = continuousSpan(row)
  if (span === undefined || content <= 0) {
    return false
  }
  return (span.end - span.start) / content >= 0.6
}

/**
 * Detect table-row baselines: a contiguous run of rows whose runs align to a
 * repeated set of interior cell x-starts, carrying numeric evidence or a
 * "Table N" caption. Their cell gaps must not be mistaken for column gutters,
 * and their cells are reconstructed row-major and preserved as-is.
 */
function detectTableRows(
  rows: readonly Row[],
  contentLeft: number,
  contentRight: number,
): ReadonlyMap<number, ReadonlySet<number>> {
  const contentMid = (contentLeft + contentRight) / 2
  const isInterior = (x: number): boolean => x > contentLeft + 20
  const rowCells = new Map<number, ReadonlySet<number>>()
  const cellStartToRows = new Map<number, number[]>()
  rows.forEach((row, rowIndex) => {
    const seen = new Set<number>()
    for (const run of rowVisible(row.runs)) {
      const s = Math.round(run.x)
      if (isInterior(s) && !seen.has(s)) {
        seen.add(s)
        const list = cellStartToRows.get(s) ?? []
        list.push(rowIndex)
        cellStartToRows.set(s, list)
      }
    }
  })
  const recurring = new Set<number>()
  for (const [s, list] of cellStartToRows) {
    if (list.length >= 2) {
      recurring.add(s)
    }
  }

  const isGridRow = (row: Row): boolean => {
    const vis = rowVisible(row.runs)
    if (vis.length < 2) {
      return false
    }
    let aligned = 0
    for (const run of vis) {
      if (recurring.has(Math.round(run.x))) {
        aligned += 1
      }
    }
    return aligned >= 2
  }

  // Group consecutive grid rows (with small y gaps) into candidate blocks.
  interface BlockCandidate {
    readonly rows: number[]
    readonly first: number
    readonly last: number
  }
  const blocks: BlockCandidate[] = []
  let current: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (isGridRow(rows[index]!)) {
      current.push(index)
    } else if (current.length > 0) {
      blocks.push({ rows: current, first: current[0]!, last: current[current.length - 1]! })
      current = []
    }
  }
  if (current.length > 0) {
    blocks.push({ rows: current, first: current[0]!, last: current[current.length - 1]! })
  }

  // Flood-fill label rows (title/band rows with few runs) between block rows so
  // a full-width table's header and section rows stay part of the table band.
  const isFiller = (row: Row): boolean => {
    const vis = rowVisible(row.runs)
    if (vis.length === 0 || vis.length >= 3) {
      return false
    }
    // A short label row whose extent stays inside the table's cell x-range.
    const minStart = Math.min(...vis.map((r) => r.x))
    const maxEnd = Math.max(...vis.map((r) => r.x + r.width))
    return maxEnd - minStart < (contentRight - contentLeft) * 0.5
  }

  const validated: Array<{ readonly rows: number[]; readonly minNum: number; readonly maxNum: number }> = []
  for (const block of blocks) {
    if (block.rows.length < 3) {
      continue
    }
    const blockRows = block.rows.map((index) => rows[index]!)
    let numericRuns = 0
    let totalRuns = 0
    const numericStartCount = new Map<number, number>()
    for (const row of blockRows) {
      const vis = rowVisible(row.runs)
      totalRuns += vis.length
      for (const run of vis) {
        if (isNumericToken(run.text)) {
          numericRuns += 1
          const key = Math.round(run.x)
          numericStartCount.set(key, (numericStartCount.get(key) ?? 0) + 1)
        }
      }
    }
    // The table's numeric cells recur at stable x positions across its rows; a
    // lone year in a reference line appears once and must not widen the table.
    let minNum = Number.POSITIVE_INFINITY
    let maxNum = Number.NEGATIVE_INFINITY
    for (const [start, count] of numericStartCount) {
      if (count >= 2) {
        minNum = Math.min(minNum, start)
        maxNum = Math.max(maxNum, start + 30)
      }
    }
    const numericFraction = totalRuns > 0 ? numericRuns / totalRuns : 0
    const firstY = rows[block.first]!.y
    const lastY = rows[block.last]!.y
    const captionNearby = rows.some((row) => {
      const y = row.y
      const near = Math.abs(y - firstY) <= 60 || Math.abs(y - lastY) <= 60
      return near && /^Table\s+\d+\s*[:.]/i.test(rowVisible(row.runs).map((r) => r.text).join(' ').trim())
    })
    const isTable = numericFraction >= 0.5 || (captionNearby && numericFraction >= 0.25)
    if (!isTable) {
      continue
    }
    // Expand the block downward to include filler label rows that follow.
    const expanded = [...block.rows]
    for (let index = block.last + 1; index < rows.length; index += 1) {
      if (isFiller(rows[index]!)) {
        expanded.push(index)
      } else {
        break
      }
    }
    validated.push({ rows: expanded, minNum, maxNum })
  }

  for (const table of validated) {
    // A table whose numeric cells cross the content midpoint spans both columns.
    const fullWidth = table.minNum <= contentMid && table.maxNum >= contentMid
    for (const index of table.rows) {
      const row = rows[index]!
      const cells = new Set<number>()
      rowVisible(row.runs).forEach((run, runIndex) => {
        if (fullWidth) {
          cells.add(runIndex)
        } else if (run.x + run.width / 2 >= contentMid) {
          cells.add(runIndex)
        }
      })
      if (cells.size > 0) {
        rowCells.set(index, cells)
      }
    }
  }
  return rowCells
}

/**
 * Detect a two-column layout by finding the interior low-occupancy vertical
 * corridor between the left column's right edge and the right column's left
 * edge, using occupancy across *different* baselines (no shared-baseline pair
 * is required) after excluding full-width bands and table rows whose internal
 * gaps would otherwise look like gutters.
 */
function detectColumns(
  rows: readonly Row[],
  tableRows: ReadonlySet<number>,
): { readonly leftEnd: number; readonly rightStart: number } | undefined {
  let contentLeft = Number.POSITIVE_INFINITY
  let contentRight = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    for (const run of rowVisible(row.runs)) {
      contentLeft = Math.min(contentLeft, run.x)
      contentRight = Math.max(contentRight, run.x + run.width)
    }
  }
  if (!Number.isFinite(contentLeft) || !Number.isFinite(contentRight) || contentRight <= contentLeft) {
    return undefined
  }
  const usable: Row[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (tableRows.has(index) || isFullWidthBand(rows[index]!, contentLeft, contentRight)) {
      continue
    }
    if (rowVisible(rows[index]!.runs).length > 0) {
      usable.push(rows[index]!)
    }
  }
  if (usable.length === 0) {
    return undefined
  }

  const minX = Math.floor(contentLeft)
  const maxX = Math.ceil(contentRight)
  const occ = new Array<number>(maxX - minX + 2).fill(0)
  for (const row of usable) {
    for (const run of rowVisible(row.runs)) {
      const from = Math.max(minX, Math.floor(run.x))
      const to = Math.min(maxX, Math.ceil(run.x + run.width))
      for (let x = from; x <= to; x += 1) {
        occ[x - minX] = (occ[x - minX] ?? 0) + 1
      }
    }
  }
  let maxOcc = 0
  for (const count of occ) {
    maxOcc = Math.max(maxOcc, count)
  }
  const emptyThreshold = Math.max(2, Math.floor(maxOcc * 0.15))

  // Maximal interior zero/low-occupancy corridors (exclude page edges).
  const corridors: Array<{ readonly start: number; readonly end: number }> = []
  let cursor = minX
  while (cursor <= maxX) {
    if ((occ[cursor - minX] ?? 0) <= emptyThreshold) {
      let end = cursor
      while (end <= maxX && (occ[end - minX] ?? 0) <= emptyThreshold) {
        end += 1
      }
      if (
        end - cursor >= 3 &&
        cursor > contentLeft + 5 &&
        end < contentRight - 5
      ) {
        corridors.push({ start: cursor, end })
      }
      cursor = end
    } else {
      cursor += 1
    }
  }

  // Prefer a corridor (interior low-occupancy band) separating two regions that
  // are each genuinely occupied; the widest such corridor is the column gutter.
  const candidates = corridors
    .map((corridor) => ({ corridor, width: corridor.end - corridor.start }))
    .filter(({ corridor }) => {
      const leftOcc = corridor.start - 1 - minX >= 0 ? occ[corridor.start - 1 - minX] ?? 0 : 0
      const rightOcc = corridor.end - minX < occ.length ? occ[corridor.end - minX] ?? 0 : 0
      return leftOcc > emptyThreshold && rightOcc > emptyThreshold
    })
    .sort((a, b) => b.width - a.width)

  const chosen = candidates[0]
  if (chosen === undefined) {
    return undefined
  }
  return { leftEnd: chosen.corridor.start, rightStart: chosen.corridor.end }
}

/** Annotate a run with the region it belongs to after a column split. */
type RunRegion = 0 | 1 | 'full'

function runRegion(
  run: PlacedRun,
  layout: { readonly leftEnd: number; readonly rightStart: number } | undefined,
  contentWidth: { readonly left: number; readonly right: number },
): RunRegion {
  if (layout === undefined) {
    return 0
  }
  const intersectsLeft = run.x < layout.rightStart - 2
  const extendsPastRight = run.x + run.width > layout.leftEnd + 2
  if (intersectsLeft && extendsPastRight) {
    // A run genuinely crossing the corridor is a full-width band.
    if (run.x + run.width - run.x >= (contentWidth.right - contentWidth.left) * 0.4) {
      return 'full'
    }
  }
  return run.x + run.width / 2 < (layout.leftEnd + layout.rightStart) / 2 ? 0 : 1
}

/** The text of a cluster, joining runs with a word separator between real gaps. */
function joinRuns(runs: readonly PlacedRun[]): string {
  let line = ''
  for (const [index, run] of runs.entries()) {
    line += run.text
    const next = runs[index + 1]
    if (
      next !== undefined &&
      next.x - (run.x + run.width) > 0 &&
      !/\s$/.test(run.text) &&
      !/^\s/.test(next.text)
    ) {
      line += ' '
    }
  }
  return line.trim()
}

/** True when adjacent runs on this baseline overlap, so left-to-right order is ambiguous. */
function runsOverlap(runs: readonly PlacedRun[]): boolean {
  const sorted = [...runs].sort((a, b) => a.x - b.x)
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!
    const next = sorted[i + 1]!
    const accent = /^[\p{M}\u02c6\u02dc\u00a8\u00b4`]+$/u
    if (accent.test(current.text.trim()) || accent.test(next.text.trim())) {
      continue
    }
    if (next.x < current.x + current.width - 1) {
      return true
    }
  }
  return false
}

interface RawPlaced {
  readonly x: number
  readonly width: number
  readonly text: string
  readonly font?: string
  readonly height?: number
  readonly horizontal: boolean
}

/**
 * Reconstruct the reading order of a page, keeping every non-whitespace source
 * character covered exactly once.
 *
 * Prose columns are detected as bounded regions: a genuine two-column page has
 * an interior low-occupancy corridor (a narrow vertical band that almost every
 * row leaves empty, so no shared baseline pair is required) with a repeated
 * prose start on its right and a repeated prose end on its left. Full-width
 * bands (headings, full-width tables) and table rows are excluded from corridor
 * detection so their internal gaps never look like column gutters. Each run is
 * assigned to a region before baselines are grouped, and reading order flushes
 * the whole left column top-to-bottom before the right column per contiguous
 * block. Genuinely ambiguous or unsupported geometry stays readable as ordinary
 * text rather than being claimed as a table or a column split.
 */
function reconstructColumnLines(items: readonly TextRunItem[]): ReconstructedLine[] {
  const groups = new Map<number, RawPlaced[]>()
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
    const horizontal = (transform[1] ?? 1) === 0 && (transform[2] ?? 0) === 0
    const font = typeof item.fontName === 'string' ? item.fontName : undefined
    const height = typeof item.height === 'number' ? item.height : undefined
    const y = Math.round(rawY)
    const placed: RawPlaced[] = [...(groups.get(y) ?? [])]
    placed.push({ x, width, text: item.str, font, height, horizontal })
    groups.set(y, placed)
  }
  const orderedY = [...groups.keys()].sort((a, b) => b - a)
  const rows: Row[] = orderedY.map((y) => ({
    y,
    runs: [...(groups.get(y) ?? [])].sort((a, b) => a.x - b.x),
  }))

  if (rows.length === 0) {
    return []
  }

  // A lone line on a page with no other content is a simple single row.
  if (rows.length === 1) {
    const row = rows[0]!
    return [{
      text: joinRuns(row.runs),
      baselineY: row.y,
      ...(runsOverlap(row.runs) ? { ambiguous: true } : {}),
    }].filter((line) => line.text.trim().length > 0)
  }

  let contentLeft = Number.POSITIVE_INFINITY
  let contentRight = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    for (const run of rowVisible(row.runs)) {
      contentLeft = Math.min(contentLeft, run.x)
      contentRight = Math.max(contentRight, run.x + run.width)
    }
  }
  if (!Number.isFinite(contentLeft) || contentLeft >= contentRight) {
    return rows
      .map((row) => ({ text: joinRuns(row.runs), baselineY: row.y }))
      .filter((line) => line.text.trim().length > 0)
  }
  const contentBounds = { left: contentLeft, right: contentRight }

  const rowCells = detectTableRows(rows, contentLeft, contentRight)
  const layout = detectColumns(rows, new Set(rowCells.keys()))

  const lines: ReconstructedLine[] = []
  const block: Array<{ row: Row; clusters: Array<{ region: 0 | 1; runs: readonly PlacedRun[]; recognized?: 'table' }> }> = []
  const flush = (): void => {
    if (block.length === 0) {
      return
    }
    for (const column of [0, 1] as const) {
      for (const entry of block) {
        for (const cluster of entry.clusters) {
          if (cluster.region === column) {
            const text = joinRuns(cluster.runs)
            if (text.trim().length > 0) {
              lines.push({
                text,
                baselineY: entry.row.y,
                column,
                ...(cluster.recognized === undefined ? {} : { recognized: cluster.recognized }),
                ...(runsOverlap(cluster.runs) ? { ambiguous: true } : {}),
              })
            }
          }
        }
      }
    }
    block.length = 0
  }

  const emitBandRuns = (runs: readonly PlacedRun[], y: number, recognized?: 'table'): void => {
    const text = joinRuns(runs)
    if (text.trim().length === 0) {
      return
    }
    lines.push({
      text,
      baselineY: y,
      ...(recognized === undefined ? {} : { recognized }),
      ...(runsOverlap(runs) ? { ambiguous: true } : {}),
    })
  }

  for (const [rowIndex, row] of rows.entries()) {
    const cellSet = rowCells.get(rowIndex)
    const vis = rowVisible(row.runs)
    const nextRow = rows[rowIndex + 1]
    const nextSpan = nextRow === undefined ? undefined : continuousSpan(nextRow)
    const scopeHeading = /^(?:references|bibliography|works cited|appendices|appendix(?:\s+\S+)?)$/i.test(joinRuns(vis))
    const headingBeforeSpanningBlock = scopeHeading && layout !== undefined && nextRow !== undefined
      && nextSpan !== undefined && row.y - nextRow.y <= 36
      && nextSpan.start < layout.leftEnd && nextSpan.end > layout.rightStart
      && nextSpan.end - nextSpan.start >= (contentRight - contentLeft) * 0.6
    if (headingBeforeSpanningBlock) {
      flush()
      emitBandRuns(row.runs, row.y)
      continue
    }
    const isCell = new Set<number>()
    for (const cellIndex of cellSet ?? []) {
      isCell.add(cellIndex)
    }
    let rowFull = false
    for (const run of vis) {
      if (runRegion(run, layout, contentBounds) === 'full') {
        rowFull = true
        break
      }
    }
    if (rowFull) {
      flush()
      emitBandRuns(row.runs, row.y)
      continue
    }

    const cellRuns = vis.filter((_run, index) => isCell.has(index))
    const cellSpansBoth =
      layout !== undefined &&
      cellRuns.some((r) => r.x + r.width / 2 < (layout.leftEnd + layout.rightStart) / 2) &&
      cellRuns.some((r) => r.x + r.width / 2 >= (layout.leftEnd + layout.rightStart) / 2)

    // Group the row's runs into region clusters.
    const clusters: Array<{ region: 0 | 1; runs: readonly PlacedRun[]; recognized?: 'table' }> = []
    let current: PlacedRun[] = []
    let currentIsCell = false
    let currentRegion: 0 | 1 | undefined
    for (const [index, run] of vis.entries()) {
      const region = runRegion(run, layout, contentBounds)
      if (region === 'full') {
        continue
      }
      const asRegion: 0 | 1 = region === 1 ? 1 : 0
      if (currentRegion === undefined) {
        currentRegion = asRegion
        currentIsCell = isCell.has(index)
        current = [run]
      } else if (asRegion === currentRegion && currentIsCell === isCell.has(index)) {
        current.push(run)
      } else {
        clusters.push(
          currentIsCell
            ? { region: currentRegion, runs: current, recognized: 'table' }
            : { region: currentRegion, runs: current },
        )
        currentRegion = asRegion
        currentIsCell = isCell.has(index)
        current = [run]
      }
    }
    if (currentRegion !== undefined && current.length > 0) {
      clusters.push(
        currentIsCell
          ? { region: currentRegion, runs: current, recognized: 'table' }
          : { region: currentRegion, runs: current },
      )
    }

    if (cellSpansBoth && cellRuns.length > 0) {
      flush()
      emitBandRuns(cellRuns, row.y, 'table')
      const nonCellRuns = vis.filter((_run, index) => !isCell.has(index))
      if (nonCellRuns.length > 0 && layout !== undefined) {
        block.push({ row, clusters: clusters.filter((c) => c.recognized !== 'table') })
      }
      continue
    }

    // A full-width heading band that genuinely straddles both columns.
    const span = continuousSpan(row)
    const fullSpan =
      span !== undefined &&
      span.end - span.start >= (contentBounds.right - contentBounds.left) * 0.6 &&
      layout !== undefined &&
      span.start < layout.rightStart - 2 &&
      span.end > layout.leftEnd + 2
    if (fullSpan) {
      flush()
      emitBandRuns(row.runs, row.y)
      continue
    }

    if (layout === undefined) {
      emitBandRuns(row.runs, row.y)
    } else {
      block.push({ row, clusters })
    }
  }
  flush()
  return lines
}

export async function readPage(
  document: PDFDocumentProxy,
  readerPage: number,
): Promise<ExtractedPaperPage> {
  const page = await document.getPage(readerPage)
  const [view, content] = await Promise.all([page.getViewport({ scale: 1 }), page.getTextContent()])
  const runs: TextRunItem[] = []
  for (const item of content.items) {
    if (isTextRun(item)) {
      runs.push(item)
    }
  }
  const reconstructed = reconstructColumnLines(runs)
  return {
    readerPage,
    pageWidth: view.width,
    pageHeight: view.height,
    textRuns: runs.filter((run) => typeof run.str === 'string' && run.str.trim() !== '').map((run) => ({
      text: typeof run.str === 'string' ? run.str : '',
      x: typeof run.transform?.[4] === 'number' ? run.transform[4] : Number.NaN,
      y: typeof run.transform?.[5] === 'number' ? run.transform[5] : Number.NaN,
      width: typeof run.width === 'number' ? run.width : Number.NaN,
      horizontal: (run.transform?.[1] ?? 1) === 0 && (run.transform?.[2] ?? 0) === 0,
    })),
    lines: reconstructed.map((line): ExtractedPaperLine => {
      const base: ExtractedPaperLine = { text: line.text, isHeading: isPdfHeadingLine(line.text), baselineY: line.baselineY }
      const withColumn = line.column === undefined ? base : { ...base, column: line.column }
      const withRecognized = line.recognized === undefined ? withColumn : { ...withColumn, recognized: line.recognized }
      return line.ambiguous === undefined ? withRecognized : { ...withRecognized, ambiguous: line.ambiguous }
    }),
    headings: reconstructed.map((line) => line.text).filter(isPdfHeadingLine),
    text: reconstructed.map((line) => line.text).join('\n'),
  }
}
