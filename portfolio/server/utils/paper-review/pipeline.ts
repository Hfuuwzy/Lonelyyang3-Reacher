import type { PaperReviewFinding, PaperReviewGap, PaperReviewReport, PaperReviewSectionKind, PaperReviewStreamEvent } from '../../../app/utils/paper-review-contract'
import { PAPER_REVIEW_SECTION_KINDS } from '../../../app/utils/paper-review-contract'
import { extractPaperPages } from './pdf'
import { runPaperReview } from './harness'
import { buildScopedReportPages } from './report'
import {
  parsePaperReviewMultipart,
  PAPER_PDF_BYTE_CAP,
  type PaperReviewMultipartPart,
} from './multipart'
import {
  buildPaperReviewPrompt,
  buildSourceInventoryPrompt,
  buildSourceReviewPrompt,
  buildTranslationPrompt,
} from './prompt'
import { validateInventoryBatch } from './source-inventory'
import { validateTranslationBatch } from './translation'
import { freezePaperTranslation, validateSourceReviewBatch } from './source-review'
import { buildSourceCandidates } from './source-candidate'
import { sourceDigest, unitGap } from './source-ledger'
import { collectStructuralHeadings } from './source-matching'
import {
  EXTRACTION_MESSAGES,
  cancelled,
  isAborted,
  makeTaskResult,
  safeMessage,
} from '../../paper-review-internal/pipeline-outcomes'
import { runBoundedShards } from '../../paper-review-internal/bounded-prompts'
import { kindCounts, parseEvidenceNotes, synthesizeReport } from '../../paper-review-internal/report-notes'
import { partitionIds, partitionPagesByText } from '../../paper-review-internal/batching'
import { isTranslationEligible } from '../../../app/utils/paper-review-task-contract'
import type { PaperSourceReview, PaperReviewTaskGap, PaperSourceUnit, PaperTranslationPair } from '../../../app/utils/paper-review-task-contract'
import type {
  PaperReviewPipelineDependencies,
  PaperReviewLifecycleOptions,
} from '../../paper-review-internal/pipeline-types'
export type {
  PaperReviewPipelineDependencies,
  PaperReviewLifecycleOptions,
} from '../../paper-review-internal/pipeline-types'

function sourceOrder(units: readonly PaperSourceUnit[]): readonly PaperSourceUnit[] {
  return [...units].sort((a, b) => {
    const left = a.spans[0]
    const right = b.spans[0]
    return left && right ? left.readerPage - right.readerPage || left.lineIndex - right.lineIndex || left.start - right.start : 0
  })
}

function reviewRunFailedGaps(units: readonly PaperSourceUnit[], reason: string): readonly PaperReviewTaskGap[] {
  if (units.length === 0) {
    return [{ artifact: 'source-review', code: 'review-run-failed', origin: 'application', unitIds: [], readerPages: [], spans: [], reason }]
  }
  return units.map((unit) => ({ ...unitGap(unit, 'source-review', 'review-run-failed'), reason }))
}

export async function* createPaperReviewEvents(
  parts: readonly PaperReviewMultipartPart[],
  dependencies: PaperReviewPipelineDependencies = {},
  options: PaperReviewLifecycleOptions = {},
): AsyncGenerator<PaperReviewStreamEvent> {
  const extract = dependencies.extractPaperPages ?? extractPaperPages
  const run = dependencies.runPaperReview ?? runPaperReview
  const validateInventory = dependencies.validateInventoryBatch ?? validateInventoryBatch
  const validateTranslation = dependencies.validateTranslationBatch ?? validateTranslationBatch
  const freeze = dependencies.freezePaperTranslation ?? freezePaperTranslation
  const validateReview = dependencies.validateSourceReviewBatch ?? validateSourceReviewBatch
  const signal = options.signal

  if (isAborted(signal)) {
    yield cancelled('validating')
    return
  }
  yield { type: 'stage', stage: 'validating' }

  const parsed = parsePaperReviewMultipart(parts, PAPER_PDF_BYTE_CAP)
  if (!parsed.success) {
    yield { type: 'error', stage: 'validating', code: parsed.error.code, message: parsed.error.message }
    return
  }
  const input = parsed.input

  if (isAborted(signal)) {
    yield cancelled('extracting')
    return
  }
  yield { type: 'stage', stage: 'extracting' }
  const extraction = await extract(input.pdf, signal)
  if (isAborted(signal)) {
    yield cancelled('extracting')
    return
  }
  if (!extraction.success) {
    yield {
      type: 'error',
      stage: 'extracting',
      code: extraction.error.code,
      message: safeMessage(EXTRACTION_MESSAGES, extraction.error.code, 'PDF 处理失败，请重新提交。'),
    }
    return
  }
  const pages = extraction.pages

  if (isAborted(signal)) {
    yield cancelled('inventorying')
    return
  }
  yield { type: 'stage', stage: 'inventorying' }
  const candidates = buildSourceCandidates(pages)
  const candidateBatches = partitionIds(candidates.map((candidate) => ({ id: candidate.id, text: candidate.text })))
  const inventoryShard = await runBoundedShards(
    run,
    { input, signal, stage: 'inventorying', purpose: 'inventory' },
    candidateBatches.map((batch) => buildSourceInventoryPrompt(pages, batch)),
  )
  if (inventoryShard.kind === 'fatal') {
    yield inventoryShard.error
    return
  }
  const inventoryUnits: PaperSourceUnit[] = []
  const sourceGaps: PaperReviewTaskGap[] = []
  for (let index = 0; index < candidateBatches.length; index += 1) {
    const batchIds = candidateBatches[index]!
    const slot = inventoryShard.slots[index]!
    const outcome = validateInventory(pages, batchIds, slot.kind === 'ok' ? slot.text : '[]')
    inventoryUnits.push(...outcome.units)
    sourceGaps.push(...outcome.gaps)
    if (slot.kind === 'run-failed') {
      sourceGaps.push({
        artifact: 'source', code: 'inventory-run-failed', origin: 'application', unitIds: [], readerPages: [], spans: [],
        reason: 'The inventory model call failed for a source batch; its prose stays translation-eligible but classification is incomplete.',
      })
    } else if (slot.kind === 'oversize') {
      sourceGaps.push({
        artifact: 'source', code: 'inventory-oversize', origin: 'application', unitIds: [], readerPages: [], spans: [],
        reason: 'A source batch exceeds the classification prompt budget; it was not truncated or blindly sent, and its prose stays translation-eligible.',
      })
    }
  }
  const source = { sourceId: sourceDigest(pages), pageCount: pages.length, units: sourceOrder(inventoryUnits) }

  if (isAborted(signal)) {
    yield cancelled('analyzing')
    return
  }
  yield { type: 'stage', stage: 'analyzing' }
  // The report model only ever sees in-scope evidence: bibliography/reference and
  // page-number lines are masked out, while appendix, formula, and table content
  // stay citable. Each chunk renders a bounded slice but carries the full scoped
  // document for global heading inheritance, and every finding is verified
  // against the global scoped source + global headings — not just the chunk. A
  // chunk produces partial section notes for only the kinds it supports; the
  // five-kind coverage is enforced only on the final synthesized report. A
  // non-fatal batch failure localizes and translation/review still proceed.
  const scopedReportPages = buildScopedReportPages(pages, source.units)
  const reportChunks = pages.length === 0 ? [[]] : partitionPagesByText(scopedReportPages)
  const reportContext = {
    pages: scopedReportPages,
    pageCount: Math.max(0, ...scopedReportPages.map((page) => page.readerPage)),
    headings: collectStructuralHeadings(scopedReportPages),
  }
  const reportShard = await runBoundedShards(
    run,
    { input, signal, stage: 'analyzing', purpose: 'report' },
    reportChunks.map((chunk) =>
      buildPaperReviewPrompt({ providerLabel: input.providerLabel, model: input.model, pages: chunk, allPages: scopedReportPages })),
  )
  if (reportShard.kind === 'fatal') {
    yield reportShard.error
    return
  }
  const findingsByKind = new Map<PaperReviewSectionKind, PaperReviewFinding[]>()
  const titles = new Map<PaperReviewSectionKind, string>()
  const droppedByKind = kindCounts()
  const unlocatedByKind = kindCounts()
  let partialBatches = 0
  const generationGaps: PaperReviewGap[] = []
  for (let index = 0; index < reportChunks.length; index += 1) {
    const slot = reportShard.slots[index]!
    if (slot.kind !== 'ok') {
      partialBatches += 1
      continue
    }
    const parsed = parseEvidenceNotes(slot.text, reportContext)
    if (parsed.kind === 'unusable') {
      partialBatches += 1
      continue
    }
    const notes = parsed.notes
    generationGaps.push(...notes.gaps)
    for (const [kind, findings] of notes.findingsByKind) {
      findingsByKind.set(kind, [...(findingsByKind.get(kind) ?? []), ...findings])
    }
    for (const kind of PAPER_REVIEW_SECTION_KINDS) {
      const noteTitle = notes.titles.get(kind)
      if (noteTitle !== undefined) {
        titles.set(kind, noteTitle)
      }
      droppedByKind[kind] += notes.droppedByKind[kind]
      unlocatedByKind[kind] += notes.unlocatedByKind[kind]
    }
  }
  const emptyReaderPages = scopedReportPages.filter((page) => page.text.trim() === '').map((page) => page.readerPage)
  const report: PaperReviewReport | null = reportChunks.length === 0
    ? null
    : synthesizeReport({
        provider: input.providerLabel,
        model: input.model,
        findingsByKind,
        titles,
        droppedByKind,
        unlocatedByKind,
        emptyReaderPages,
        partialBatches,
        generationGaps,
      })

  if (isAborted(signal)) {
    yield cancelled('translating')
    return
  }
  yield { type: 'stage', stage: 'translating' }
  const eligibleUnits = source.units.filter(isTranslationEligible)
  const translationBatches = partitionIds(eligibleUnits.map((unit) => ({ id: unit.id, text: unit.original })))
  const translationShard = await runBoundedShards(
    run,
    { input, signal, stage: 'translating', purpose: 'translation' },
    translationBatches.map((batch) => buildTranslationPrompt(source, batch)),
  )
  if (translationShard.kind === 'fatal') {
    yield translationShard.error
    return
  }
  const pairs: PaperTranslationPair[] = []
  const translationGaps: PaperReviewTaskGap[] = []
  for (let index = 0; index < translationBatches.length; index += 1) {
    const batchIds = translationBatches[index]!
    const slot = translationShard.slots[index]!
    if (slot.kind !== 'ok') {
      const code = slot.kind === 'oversize' ? 'oversize-prompt' : 'translation-run-failed'
      const reason = slot.kind === 'oversize'
        ? '该批原文体积超过单次可处理上限，未盲目发送或截断，本次未生成译文。'
        : '本次无法生成该单元的译文。'
      for (const unitId of batchIds) {
        const unit = source.units.find((candidate) => candidate.id === unitId)
        pairs.push({ unitId, chinese: null })
        if (unit !== undefined) {
          translationGaps.push({ ...unitGap(unit, 'translation', code), reason })
        }
      }
      continue
    }
    const result = validateTranslation(source, batchIds, slot.text)
    pairs.push(...result.pairs)
    translationGaps.push(...result.gaps)
  }
  const pairById = new Map(pairs.map((pair) => [pair.unitId, pair]))
  const orderedPairs = source.units.filter(isTranslationEligible).map((unit) => pairById.get(unit.id) ?? { unitId: unit.id, chinese: null })
  const translationFailedAll = translationBatches.length > 0 && translationBatches.every((_, index) => translationShard.slots[index]?.kind !== 'ok')

  const frozen = freeze(source, orderedPairs)
  if (translationFailedAll) {
    yield {
      type: 'result',
      result: makeTaskResult({
        input, source, report, pairs: orderedPairs,
        review: { reviewOf: frozen.reviewOf, status: 'not-run', checks: [] },
        gaps: [...sourceGaps, ...translationGaps, ...reviewRunFailedGaps(source.units, '译文未生成，本次未进行原文对照复检。')],
      }),
    }
    return
  }

  if (isAborted(signal)) {
    yield cancelled('verifying')
    return
  }
  yield { type: 'stage', stage: 'verifying' }
  const reviewBatches = partitionIds(source.units.map((unit) => ({ id: unit.id, text: unit.original })))
  const reviewShard = await runBoundedShards(
    run,
    { input, signal, stage: 'verifying', purpose: 'source-review' },
    reviewBatches.map((batch) => buildSourceReviewPrompt(frozen, batch)),
  )
  if (reviewShard.kind === 'fatal') {
    yield reviewShard.error
    return
  }
  const checks: { unitId: string; verdict: 'passed' | 'issues' }[] = []
  const reviewGaps: PaperReviewTaskGap[] = []
  for (let index = 0; index < reviewBatches.length; index += 1) {
    const batchIds = reviewBatches[index]!
    const slot = reviewShard.slots[index]!
    if (slot.kind !== 'ok') {
      const code = slot.kind === 'oversize' ? 'oversize-prompt' : 'review-run-failed'
      const reason = slot.kind === 'oversize'
        ? '该批原文对照材料体积超过单次可处理上限，未盲目发送或截断，本次未完成复检。'
        : '本次未能完成该单元的原文对照复检。'
      for (const unitId of batchIds) {
        checks.push({ unitId, verdict: 'issues' })
        const unit = source.units.find((candidate) => candidate.id === unitId)
        if (unit !== undefined) {
          reviewGaps.push({ ...unitGap(unit, 'source-review', code), reason })
        }
      }
      continue
    }
    const result = validateReview(frozen, batchIds, slot.text)
    checks.push(...result.review.checks)
    reviewGaps.push(...result.gaps)
  }
  const checkByUnit = new Map(checks.map((check) => [check.unitId, check.verdict]))
  const mergedChecks = source.units.map((unit) => ({ unitId: unit.id, verdict: checkByUnit.get(unit.id) ?? 'issues' }))
  const anyIssue = reviewGaps.length > 0 || reviewBatches.length === 0 || mergedChecks.some((check) => check.verdict !== 'passed')
  const review: PaperSourceReview = {
    reviewOf: frozen.reviewOf,
    status: anyIssue ? 'incomplete' : 'passed',
    checks: mergedChecks,
  }

  yield {
    type: 'result',
    result: makeTaskResult({
      input, source, report, pairs: orderedPairs, review,
      gaps: [...sourceGaps, ...translationGaps, ...reviewGaps],
    }),
  }
}
