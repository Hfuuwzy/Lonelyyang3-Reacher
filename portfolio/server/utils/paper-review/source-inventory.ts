import { z } from 'zod'
import type { PaperReviewTaskGap, PaperSourceInventory, PaperSourceUnit } from '../../../app/utils/paper-review-task-contract'
import type { ExtractedPaperPage } from './pdf'
import { sourceDigest, sourceLines, unitGap, assertNever, type SourceLine } from './source-ledger'
import { parseModelJson } from './model-json'
import { buildSourceCandidates, type PaperSourceCandidate } from './source-candidate'

/**
 * Application-owned source inventory validation (issue #29 reconstruction).
 *
 * The application owns candidates, grouping, exact originals, spans, IDs, and
 * reading order (`buildSourceCandidates`). The inventory model only classifies
 * candidate IDs back with a kind: its response is `[{candidateId, kind, reason?}]`
 * and it cannot supply offsets, source, new IDs, or merges. The validator
 * reconciles that classification against the application's structural evidence:
 * exclusions come only from application anchors, captions only from application
 * spans, preserved content only from structural evidence. Readable prose that a
 * classifier omits or mislabels stays translation-eligible (a localized gap,
 * never lost prose); genuinely ambiguous geometry stays unresolved.
 */

const classificationSchema = z.object({
  candidateId: z.string().min(1),
  kind: z.enum(['paragraph', 'heading', 'caption', 'excluded', 'preserved-original', 'unresolved']),
  reason: z.enum(['bibliography', 'appendix', 'formula', 'table-content', 'page-number']).optional(),
}).strict()

type ModelKind = z.infer<typeof classificationSchema>['kind']

function artifactGap(artifact: PaperReviewTaskGap['artifact'], code: string, reason: string): PaperReviewTaskGap {
  return { artifact, code, origin: 'application', unitIds: [], readerPages: [], spans: [], reason }
}

function candidateGap(candidate: PaperSourceCandidate, code: string, reason: string): PaperReviewTaskGap {
  return {
    artifact: 'source', code, origin: 'application',
    unitIds: [`u-${sourceDigest(candidate.spans).slice(0, 24)}`],
    spans: candidate.spans,
    readerPages: [...new Set(candidate.spans.map((span) => span.readerPage))],
    reason,
  }
}

function effectiveHeading(candidate: PaperSourceCandidate, ledger: readonly SourceLine[]): string {
  const first = candidate.spans[0]
  const line = ledger.find((candidateLine) => candidateLine.span.readerPage === first?.readerPage && candidateLine.span.lineIndex === first?.lineIndex)
  return line?.heading ?? ''
}

function buildUnit(candidate: PaperSourceCandidate, ledger: readonly SourceLine[], modelKind: ModelKind | undefined): PaperSourceUnit {
  const heading = effectiveHeading(candidate, ledger)
  const base = {
    id: `u-${sourceDigest(candidate.spans).slice(0, 24)}`,
    spans: candidate.spans,
    original: candidate.text,
    heading,
  }
  if (candidate.ambiguous) {
    return { ...base, kind: 'unresolved' }
  }
  if (candidate.exclusion !== undefined) {
    return { ...base, kind: 'excluded', reason: candidate.exclusion.reason, headingAnchor: candidate.exclusion.headingAnchor }
  }
  if (candidate.caption) {
    return {
      ...base,
      kind: 'caption',
      mediaReaderPages: [...new Set(candidate.spans.map((span) => span.readerPage))].sort((a, b) => a - b),
    }
  }
  if (candidate.preserved !== undefined) {
    return { ...base, kind: 'preserved-original', reason: candidate.preserved }
  }
  if (candidate.headingCandidate) {
    return { ...base, kind: 'heading' }
  }
  switch (modelKind) {
    case 'heading':
      return { ...base, kind: 'heading' }
    case 'unresolved':
      return { ...base, kind: 'unresolved' }
    case 'paragraph':
    case 'caption':
    case 'excluded':
    case 'preserved-original':
    case undefined:
      return { ...base, kind: 'paragraph' }
    default:
      return assertNever(modelKind)
  }
}

/** The application-structural kind a candidate is forced to, or undefined for prose. */
function appKind(candidate: PaperSourceCandidate): Exclude<ModelKind, 'paragraph'> | undefined {
  if (candidate.ambiguous) {
    return 'unresolved'
  }
  if (candidate.exclusion !== undefined) {
    return 'excluded'
  }
  if (candidate.caption) {
    return 'caption'
  }
  if (candidate.preserved !== undefined) {
    return 'preserved-original'
  }
  if (candidate.headingCandidate) {
    return 'heading'
  }
  return undefined
}

export function reconcileInventoryBatch(
  pages: readonly ExtractedPaperPage[],
  candidateIds: readonly string[],
  raw: string,
): {
  readonly units: readonly PaperSourceUnit[]
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const candidates = buildSourceCandidates(pages)
  const ledger = sourceLines(pages)
  const requested = new Set(candidateIds)
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const gaps: PaperReviewTaskGap[] = []

  const parsed = z.array(z.unknown()).safeParse(parseModelJson(raw))
  if (!parsed.success) {
    gaps.push(artifactGap('source', 'invalid-classification', 'The inventory model response was not a JSON array of candidate classifications.'))
  }

  const modelKind = new Map<string, ModelKind>()
  const modelReason = new Map<string, string>()
  for (const entry of parsed.success ? parsed.data : []) {
    const check = classificationSchema.safeParse(entry)
    if (!check.success) {
      gaps.push(artifactGap('source', 'invalid-record', 'An inventory model record was malformed.'))
      continue
    }
    const candidate = byId.get(check.data.candidateId)
    if (candidate === undefined || !requested.has(check.data.candidateId)) {
      gaps.push(artifactGap('source', 'out-of-batch-candidate', `The inventory model classified a candidate outside this batch: ${check.data.candidateId}.`))
      continue
    }
    if (modelKind.has(check.data.candidateId)) {
      gaps.push(candidateGap(candidate, 'duplicate-candidate', 'The inventory model classified the same candidate more than once.'))
      continue
    }
    modelKind.set(check.data.candidateId, check.data.kind)
    if (check.data.reason !== undefined) {
      modelReason.set(check.data.candidateId, check.data.reason)
    }
  }

  const modelDisagrees = (candidate: PaperSourceCandidate, expected: ModelKind): boolean => {
    const kind = modelKind.get(candidate.id)
    return kind !== undefined && kind !== expected
  }

  const units: PaperSourceUnit[] = []
  for (const candidate of candidates) {
    if (!requested.has(candidate.id)) {
      continue
    }
    const structural = appKind(candidate)
    const kind = modelKind.get(candidate.id)
    const missing = kind === undefined

    if (structural !== undefined) {
      if (missing) {
        gaps.push(candidateGap(candidate, 'classifier-omission', 'The inventory model did not classify an application-structural candidate.'))
      } else if (modelDisagrees(candidate, structural)) {
        gaps.push(candidateGap(candidate, 'classification-mismatch', `The inventory model classified an application-structural candidate as ${kind}; the application evidence is authoritative.`))
      } else if (structural === 'excluded') {
        const reason = candidate.exclusion?.reason
        const claimed = modelReason.get(candidate.id)
        if (reason !== undefined && claimed !== undefined && claimed !== reason) {
          gaps.push(candidateGap(candidate, 'classification-mismatch', 'The inventory model reason for an excluded candidate conflicts with the application anchor.'))
        }
      }
      units.push(buildUnit(candidate, ledger, undefined))
      continue
    }

    if (missing) {
      units.push(buildUnit(candidate, ledger, undefined))
      gaps.push(candidateGap(candidate, 'classifier-omission', 'The inventory model did not classify this readable prose; it stays translation-eligible.'))
      continue
    }
    if (kind === 'caption' || kind === 'excluded' || kind === 'preserved-original' || kind === 'unresolved') {
      units.push(buildUnit(candidate, ledger, 'paragraph'))
      const reason = modelReason.get(candidate.id)
      const label = reason === undefined ? kind : `${kind}:${reason}`
      gaps.push(candidateGap(candidate, `invented-${kind}`, `The inventory model excluded readable prose without application evidence (${label}); it stays translation-eligible.`))
      continue
    }
    units.push(buildUnit(candidate, ledger, kind))
  }

  for (const unit of units) {
    if (unit.kind === 'unresolved') {
      gaps.push(unitGap(unit, 'source', 'unresolved-source'))
    }
  }
  return { units, gaps }
}

export function validateInventoryBatch(
  pages: readonly ExtractedPaperPage[],
  candidateIds: readonly string[],
  raw: string,
): {
  readonly units: readonly PaperSourceUnit[]
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  return reconcileInventoryBatch(pages, candidateIds, raw)
}

export function validateSourceInventory(pages: readonly ExtractedPaperPage[], raw: string): {
  readonly source: PaperSourceInventory
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const candidateIds = buildSourceCandidates(pages).map((candidate) => candidate.id)
  const { units, gaps } = reconcileInventoryBatch(pages, candidateIds, raw)
  return { source: { sourceId: sourceDigest(pages), pageCount: pages.length, units: [...units].sort(sourceOrder) }, gaps }
}

function sourceOrder(a: PaperSourceUnit, b: PaperSourceUnit): number {
  const left = a.spans[0]
  const right = b.spans[0]
  return left && right ? left.readerPage - right.readerPage || left.lineIndex - right.lineIndex || left.start - right.start : 0
}