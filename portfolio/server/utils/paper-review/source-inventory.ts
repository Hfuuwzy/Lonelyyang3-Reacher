import { z } from 'zod'
import type { PaperReviewTaskGap, PaperSourceInventory, PaperSourceUnit, PaperSourceSpan } from '../../../app/utils/paper-review-task-contract'
import type { ExtractedPaperPage } from './pdf'
import { sourceDigest, sourceLines, spanKey, unitGap, assertNever, type SourceLine } from './source-ledger'
import { parseModelJson } from './model-json'
import { layoutGaps } from './source-layout'

const spanSchema = z.object({
  readerPage: z.number().int().positive(), lineIndex: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
})
const groupSchema = z.object({
  kind: z.enum(['paragraph', 'heading', 'caption', 'excluded', 'preserved-original', 'unresolved']),
  spans: z.array(spanSchema).min(1),
  reason: z.enum(['bibliography', 'appendix', 'formula', 'table-content', 'page-number']).optional(),
  mediaReaderPages: z.array(z.number().int().positive()).optional(),
})
type Group = z.infer<typeof groupSchema>
type Classification =
  | { readonly kind: 'paragraph' | 'heading' | 'unresolved' }
  | { readonly kind: 'caption'; readonly mediaReaderPages: readonly number[] }
  | { readonly kind: 'excluded'; readonly reason: 'bibliography' | 'appendix'; readonly headingAnchor: PaperSourceSpan }
  | { readonly kind: 'preserved-original'; readonly reason: 'formula' | 'table-content' | 'page-number' }

function classify(group: Group, lines: readonly SourceLine[]): Classification {
  const first = lines[0]
  if (group.kind !== 'excluded' && lines.some(line => line.exclusion)) return { kind: 'unresolved' }
  const text = lines.map(line => line.text).join('\n')
  if (group.kind !== 'heading' && group.kind !== 'excluded' && lines.some(line => line.heading === line.text)) return { kind: 'unresolved' }
  if (group.kind !== 'caption' && /^(?:Figure|Fig\.|Table)\s+\d+[.:]/i.test(text)) return { kind: 'unresolved' }
  switch (group.kind) {
    case 'excluded':
      if (first?.exclusion && lines.every(line => JSON.stringify(line.exclusion) === JSON.stringify(first.exclusion))
        && group.reason === first.exclusion.reason) return { kind: 'excluded', ...first.exclusion }
      return { kind: 'unresolved' }
    case 'preserved-original':
      switch (group.reason) {
        case 'formula': return /^[\d\sA-Za-z_+\-*/^=().,{}\\]+$/.test(text) && text.includes('=') && !/[A-Za-z]{4,}/.test(text)
          ? { kind: 'preserved-original', reason: 'formula' } : { kind: 'unresolved' }
        case 'table-content': return lines.every(line => line.text.includes('|'))
          ? { kind: 'preserved-original', reason: 'table-content' } : { kind: 'unresolved' }
        case 'page-number': return /^\s*\d+\s*$/.test(text)
          ? { kind: 'preserved-original', reason: 'page-number' } : { kind: 'unresolved' }
        default: return { kind: 'unresolved' }
      }
    case 'caption': return /^(?:Figure|Fig\.|Table)\s+\d+[.:]/i.test(text) && group.mediaReaderPages?.length
      ? { kind: 'caption', mediaReaderPages: group.mediaReaderPages } : { kind: 'unresolved' }
    case 'heading': return lines.length === 1 && first?.heading === first?.text ? { kind: 'heading' } : { kind: 'unresolved' }
    case 'paragraph': case 'unresolved': return { kind: group.kind }
    default: return assertNever(group.kind)
  }
}

function makeUnit(group: Group, lines: readonly SourceLine[]): PaperSourceUnit {
  const original = group.spans.map(span => lines.find(line => spanKey(line.span) === spanKey(span))?.text.slice(span.start, span.end) ?? '').join('\n')
  const base = { id: `u-${sourceDigest(group.spans).slice(0, 24)}`, spans: group.spans, original, heading: lines[0]?.heading ?? '' }
  return { ...base, ...classify(group, lines) }
}

export function validateSourceInventory(pages: readonly ExtractedPaperPage[], raw: string): {
  readonly source: PaperSourceInventory
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const lines = sourceLines(pages)
  const lineMap = new Map(lines.map(line => [spanKey(line.span), line]))
  const characterRanks = new Map<string, number>()
  for (const line of lines) for (let i = 0; i < line.text.length; i++) {
    if (/\S/.test(line.text.charAt(i))) characterRanks.set(`${spanKey(line.span)}:${i}`, characterRanks.size)
  }
  const parsed = z.object({ units: z.array(z.unknown()) }).safeParse(parseModelJson(raw))
  const gaps: PaperReviewTaskGap[] = [...layoutGaps(pages)]
  const proposals: { readonly group: Group; readonly ranks: readonly number[] }[] = []
  let invalid = !parsed.success
  for (const entry of parsed.success ? parsed.data.units : []) {
    const candidate = groupSchema.safeParse(entry)
    if (!candidate.success) { invalid = true; continue }
    const group = candidate.data
    const ranks: number[] = []
    let valid = true
    for (const span of group.spans) {
      const line = lineMap.get(spanKey(span))
      if (!line || span.start >= span.end || span.end > line.text.length) { valid = false; break }
      for (let i = span.start; i < span.end; i++) {
        const rank = characterRanks.get(`${spanKey(span)}:${i}`)
        if (rank !== undefined) ranks.push(rank)
      }
    }
    if (group.mediaReaderPages?.some(page => !pages.some(source => source.readerPage === page))) valid = false
    if (!valid || ranks.length === 0 || ranks.some((rank, i) => i > 0 && rank !== (ranks[i - 1] ?? -2) + 1)) { invalid = true; continue }
    proposals.push({ group, ranks })
  }
  const owners = new Map<number, number>()
  for (const proposal of proposals) for (const rank of proposal.ranks) owners.set(rank, (owners.get(rank) ?? 0) + 1)
  const covered = new Set<number>()
  const units: PaperSourceUnit[] = []
  for (const { group, ranks } of proposals) {
    if (ranks.some(rank => owners.get(rank) !== 1)) { invalid = true; continue }
    const selected = group.spans.flatMap(span => {
      const line = lineMap.get(spanKey(span))
      return line ? [line] : []
    })
    units.push(makeUnit(group, selected))
    ranks.forEach(rank => { covered.add(rank) })
  }
  for (const line of lines) {
    let start: number | undefined
    for (let i = 0; i <= line.text.length; i++) {
      const rank = characterRanks.get(`${spanKey(line.span)}:${i}`)
      const missing = rank !== undefined && !covered.has(rank)
      if (missing && start === undefined) start = i
      if (start !== undefined && ((!missing && rank !== undefined) || i === line.text.length)) {
        units.push(makeUnit({ kind: 'unresolved', spans: [{ ...line.span, start, end: i }] }, [line]))
        start = undefined
      }
    }
  }
  for (const unit of units) if (unit.kind === 'unresolved') gaps.push(unitGap(unit, 'source', 'unresolved-source'))
  if (invalid) gaps.push({ artifact: 'source', code: 'invalid-partition', origin: 'application', unitIds: [], readerPages: [], spans: [], reason: 'The proposed source partition was invalid or incomplete.' })
  units.sort((a, b) => {
    const left = a.spans[0]
    const right = b.spans[0]
    return left && right ? left.readerPage - right.readerPage || left.lineIndex - right.lineIndex || left.start - right.start : 0
  })
  return { source: { sourceId: sourceDigest(pages), pageCount: pages.length, units }, gaps }
}
