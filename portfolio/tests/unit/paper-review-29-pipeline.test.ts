import { describe, expect, it } from 'vitest'
import { createPaperReviewEvents, type PaperReviewPipelineDependencies } from '../../server/utils/paper-review/pipeline'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { isTranslationEligible } from '../../app/utils/paper-review-task-contract'
import { buildSourceCandidates } from '../../server/utils/paper-review/source-candidate'
import { freezePaperTranslation } from '../../server/utils/paper-review/source-review'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import { paper29Bytes, paper29Pages } from '../fixtures/paper-review-29'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'

const CONFIG = { providerLabel: 'fixture', modelId: 'controlled', baseUrl: 'https://example.test/v1',
  protocol: 'openai-completions', apiKey: 'fixture-key', pdfPath: 'unused' } as const

const CHINESE = ['1 引言', '温度为 20 C 时，校准系统不会增加误差。',
  '第二段跨页继续，不丢失否定或数字：不是 30%。', '2 结果',
  '图 1. 校准后误差降低 12%。', '表 1. 实测准确率，而非预测准确率。']

/** The candidate-id classification a model returns for the fixed #29 PDF. */
function paper29Inventory(pages: readonly ExtractedPaperPage[]) {
  return buildSourceCandidates(pages).map((candidate) =>
    candidate.exclusion !== undefined ? { candidateId: candidate.id, kind: 'excluded', reason: candidate.exclusion.reason }
      : candidate.caption ? { candidateId: candidate.id, kind: 'caption' }
      : candidate.preserved !== undefined ? { candidateId: candidate.id, kind: 'preserved-original', reason: candidate.preserved }
      : candidate.headingCandidate ? { candidateId: candidate.id, kind: 'heading' }
      : { candidateId: candidate.id, kind: 'paragraph' })
}

function paperParts(pdf: Uint8Array): readonly PaperReviewMultipartPart[] {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return [
    { name: 'pdf', filename: 'paper-review-29.pdf', type: 'application/pdf', data: pdf },
    { name: 'providerLabel', data: encode(CONFIG.providerLabel) },
    { name: 'baseUrl', data: encode(CONFIG.baseUrl) },
    { name: 'protocol', data: encode(CONFIG.protocol) },
    { name: 'model', data: encode(CONFIG.modelId) },
    { name: 'apiKey', data: encode(CONFIG.apiKey) },
  ]
}

async function controlledModel(
  options: { readonly omittedCaptionId?: string; readonly failedPurpose?: string } = {},
): Promise<NonNullable<PaperReviewPipelineDependencies['runPaperReview']>> {
  const pages = await paper29Pages()
  const inventory = JSON.stringify(paper29Inventory(pages))
  const { source } = validateSourceInventory(pages, inventory)
  const eligible = source.units.filter(isTranslationEligible)
  const domainPairs = eligible.map((unit, index) => ({
    unitId: unit.id,
    chinese: unit.id === options.omittedCaptionId ? null : (CHINESE[index] ?? ''),
  }))
  const frozen = freezePaperTranslation(source, domainPairs)
  const outputs = {
    inventory,
    report: JSON.stringify({ sections: ['claims', 'methods', 'experiments', 'evidence', 'criticism'].map(kind => ({
      kind, title: kind, findings: [{ statement: '校准条件下的误差。', source: {
        heading: '1 Introduction', readerPage: 1, quote: 'The calibrated system does not increase error',
      } }],
    })), gaps: [] }),
    translation: JSON.stringify(domainPairs.filter(pair => pair.chinese !== null)),
    'source-review': JSON.stringify({
      reviewOf: frozen.reviewOf,
      status: 'complete',
      checks: source.units.map(unit => ({
        unitId: unit.id, kind: unit.kind, classification: 'passed',
        translation: isTranslationEligible(unit) ? 'passed' : 'not-applicable',
      })),
    }),
  }
  return async (_input, request) => request.purpose === options.failedPurpose
    ? { success: false, error: { code: 'run-failed', message: 'The controlled model request failed.', recoverable: true } }
    : { success: true, finalResponse: outputs[request.purpose] }
}

async function collect(runPaperReview: NonNullable<PaperReviewPipelineDependencies['runPaperReview']>) {
  const events: PaperReviewStreamEvent[] = []
  for await (const event of createPaperReviewEvents(paperParts(paper29Bytes()), { runPaperReview })) events.push(event)
  return events
}

function lastResult(events: readonly PaperReviewStreamEvent[]) {
  const terminal = events.at(-1)
  if (terminal?.type !== 'result') throw new Error('Expected a terminal task result event')
  return terminal.result
}

describe('#29 real PDF task acceptance', () => {
  it('completes only with exhaustive source, report, translations and frozen review', async () => {
    // Given the fixed PDF and one purpose-keyed controlled model adapter.
    const model = await controlledModel()
    // When real extraction and every application validator run.
    const events = await collect(model)
    // Then one terminal result accounts for the entire source and every artifact.
    const result = lastResult(events)
    expect(events.filter(event => event.type !== 'stage')).toHaveLength(1)
    expect(result.status).toBe('complete')
    expect(result.gaps).toEqual([])
    expect(result.source.pageCount).toBe(2)
    expect(result.source.units.map(unit => unit.kind)).toEqual([
      'heading', 'paragraph', 'paragraph', 'heading', 'caption', 'caption',
      'preserved-original', 'preserved-original', 'excluded', 'excluded',
    ])
    expect(result.source.units[2]?.original).toBe('A second paragraph crosses the page boundary and\ncontinues without losing its negation or numbers: not 30%.')
    expect(result.source.units[8]).toMatchObject({ reason: 'bibliography' })
    expect(result.source.units[9]).toMatchObject({ reason: 'appendix' })
    expect(result.translation.pairs).toHaveLength(6)
    expect(result.translation.pairs[1]?.chinese).toBe('温度为 20 C 时，校准系统不会增加误差。')
    expect(result.report?.sections).toHaveLength(5)
    expect(result.translation.review.status).toBe('passed')
    expect(result.translation.review.checks).toHaveLength(10)
  })

  it('emits an incomplete localized result when the model omits a caption while claiming completeness', async () => {
    // Given the fixed PDF with one caption's translation withheld but the review
    // still claiming every check passes (and a "complete" wrapper status).
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    const omitted = source.units[4] // first caption (图 1)

    // When real extraction and validators run against the withholding model.
    const events = await collect(await controlledModel({ omittedCaptionId: omitted.id }))

    // Then the terminal event is still a task result, but incomplete with the
    // withheld unit surfaced as a localized gap (unit id + reader page).
    const result = lastResult(events)
    expect(result.status).toBe('incomplete')
    expect(result.gaps.length).toBeGreaterThan(0)
    expect(result.gaps.some(gap => gap.unitIds.includes(omitted.id) && gap.readerPages.includes(2))).toBe(true)
    expect(result.translation.pairs.find(pair => pair.unitId === omitted.id)?.chinese).toBeNull()
    expect(result.translation.review.status).toBe('incomplete')
  })

  it('retains the verified report and marks the task incomplete when translation generation fails', async () => {
    // Given the fixed PDF and a model adapter that fails only the translation purpose.
    const events = await collect(await controlledModel({ failedPurpose: 'translation' }))

    // When the application assembles the terminal result.
    const result = lastResult(events)

    // Then the report remains usable, every eligible unit remains visible as missing,
    // and neither an incomplete translation nor unrun review is treated as complete.
    expect(result.status).toBe('incomplete')
    expect(result.report?.sections).toHaveLength(5)
    expect(result.translation.pairs).toHaveLength(6)
    expect(result.translation.pairs.every(pair => pair.chinese === null)).toBe(true)
    expect(result.translation.review.status).toBe('not-run')
    expect(result.gaps.some(gap => gap.artifact === 'translation' && gap.readerPages.includes(1))).toBe(true)
  })

  it('retains verified report and translations but does not claim completion when source review fails', async () => {
    // Given the fixed PDF and a model adapter that fails only the distinct review purpose.
    const events = await collect(await controlledModel({ failedPurpose: 'source-review' }))

    // When the application assembles the terminal result.
    const result = lastResult(events)

    // Then report and pairs remain available while review is attempted-but-failed and left incomplete.
    expect(result.status).toBe('incomplete')
    expect(result.report?.sections).toHaveLength(5)
    expect(result.translation.pairs).toHaveLength(6)
    expect(result.translation.pairs.every(pair => pair.chinese !== null)).toBe(true)
    expect(result.translation.review.status).toBe('incomplete')
    expect(result.gaps.some(gap => gap.artifact === 'source-review' && gap.readerPages.includes(2))).toBe(true)
  })

  it('retains translations and source review when a report batch fails, marking the report partial', async () => {
    // Given the fixed PDF and a model adapter that fails only the report purpose.
    const events = await collect(await controlledModel({ failedPurpose: 'report' }))

    // When a report batch failure localizes (only cancel/cleanup are fatal).
    const result = lastResult(events)

    // Then the report is partial (no grounded sections, an overall gap) while the
    // translation pairs and source review still complete.
    expect(result.status).toBe('incomplete')
    expect(result.report?.sections).toEqual([])
    expect(result.report?.gaps.some(gap => gap.section === 'overall')).toBe(true)
    expect(result.translation.pairs).toHaveLength(6)
    expect(result.translation.pairs.every(pair => pair.chinese !== null)).toBe(true)
    expect(result.translation.review.status).toBe('passed')
  })
})
