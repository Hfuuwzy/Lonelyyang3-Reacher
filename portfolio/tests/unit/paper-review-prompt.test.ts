import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildPaperReviewPrompt, buildSourceInventoryPrompt, buildSourceReviewPrompt, buildTranslationPrompt } from '../../server/utils/paper-review/prompt'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { paper29Pages } from '../fixtures/paper-review-29'
import { buildSourceCandidates } from '../../server/utils/paper-review/source-candidate'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { freezePaperTranslation } from '../../server/utils/paper-review/source-review'
import { isTranslationEligible } from '../../app/utils/paper-review-task-contract'

function pg(readerPage: number, headings: string[], lines: string[]): ExtractedPaperPage {
  return {
    readerPage,
    lines: lines.map((text) => ({ text, isHeading: headings.includes(text) })),
    headings,
    text: lines.join('\n'),
  }
}

/** The candidate-id classification a model returns for the fixed #29 PDF. */
function paper29Inventory(pages: readonly ExtractedPaperPage[]) {
  return buildSourceCandidates(pages).map((candidate) =>
    candidate.exclusion !== undefined ? { candidateId: candidate.id, kind: 'excluded', reason: candidate.exclusion.reason }
      : candidate.caption ? { candidateId: candidate.id, kind: 'caption' }
      : candidate.preserved !== undefined ? { candidateId: candidate.id, kind: 'preserved-original', reason: candidate.preserved }
      : candidate.headingCandidate ? { candidateId: candidate.id, kind: 'heading' }
      : { candidateId: candidate.id, kind: 'paragraph' })
}

describe('buildPaperReviewPrompt structured source context', () => {
  const source = {
    providerLabel: 'local',
    model: 'fixture-model',
    pages: [
      pg(1, ['1 Introduction'], ['1 Introduction', 'intro text']),
      pg(2, [], ['continuation without a heading']),
    ],
  }

  it('renders each page with EFFECTIVE HEADING and HEADINGS tokens', () => {
    const prompt = buildPaperReviewPrompt(source)
    expect(prompt).toContain('EFFECTIVE HEADING:')
    expect(prompt).toContain('HEADINGS:')
  })

  it('shows the inherited heading context for a continuation page', () => {
    const prompt = buildPaperReviewPrompt(source)
    // The continuation page 2 block must state the section it inherits.
    expect(prompt).toContain('## Page 2')
    expect(prompt).toContain('EFFECTIVE HEADING: 1 Introduction')
    expect(prompt).toContain('HEADINGS: (none)')
  })

  it("shows the page's own heading when the page opens with one", () => {
    const ownHeading = {
      providerLabel: 'local',
      model: 'fixture-model',
      pages: [pg(1, ['2 Methods'], ['2 Methods', 'methods text'])],
    }
    const prompt = buildPaperReviewPrompt(ownHeading)
    expect(prompt).toContain('EFFECTIVE HEADING: 2 Methods')
    expect(prompt).toContain('HEADINGS: 2 Methods')
  })

  it('echoes the caller-provided provider and model labels in the closing line', () => {
    const prompt = buildPaperReviewPrompt(source)
    expect(prompt).toContain('"provider" = "local"')
    expect(prompt).toContain('"model" = "fixture-model"')
  })

  it('never includes the API key or any secret in the prompt', () => {
    const prompt = buildPaperReviewPrompt(source)
    expect(prompt).not.toContain('apiKey')
    expect(prompt).not.toContain('secret')
    expect(prompt).not.toContain('Bearer')
  })

  it('resolves inherited heading context from allPages when a slice is rendered', () => {
    // Given a report that renders only the second page but carries the full document.
    const sliced: ExtractedPaperPage = pg(2, [], ['continuation without a heading'])
    const prompt = buildPaperReviewPrompt({ ...source, pages: [sliced], allPages: source.pages })
    // Then the effective heading still inherits the page-1 section heading.
    expect(prompt).toContain('## Page 2')
    expect(prompt).toContain('EFFECTIVE HEADING: 1 Introduction')
  })
})

describe('buildSourceInventoryPrompt machine-consumed structure', () => {
  it('serializes purpose inventory with application-owned candidate ids and text', async () => {
    // Given real extracted pages resolved through the application candidate builder.
    const pages = await paper29Pages()
    // When the purpose-specific builder renders the inventory request as JSON.
    const parsed = z.object({
      purpose: z.literal('inventory'),
      candidates: z.array(z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        exclusion: z.enum(['bibliography', 'appendix']).optional(),
        caption: z.boolean().optional(),
        preserved: z.string().optional(),
        headingCandidate: z.boolean().optional(),
      }).strict()),
    }).parse(JSON.parse(buildSourceInventoryPrompt(pages)))
    const expected = buildSourceCandidates(pages)
    // Then the machine token and the app-owned candidate ids survive in order.
    expect(parsed.candidates).toHaveLength(expected.length)
    expect(parsed.candidates.map(candidate => candidate.id)).toEqual(expected.map(candidate => candidate.id))
    const introduction = parsed.candidates.find(candidate => candidate.text === '1 Introduction')
    expect(introduction).toMatchObject({ text: '1 Introduction', headingCandidate: true })
    const bibliography = parsed.candidates.find(candidate => candidate.exclusion === 'bibliography')
    expect(bibliography?.text).toBe('References\n[1] Example Author. Calibration. 2024.')
  })

  it('classifies captions without leaking media-page geometry', async () => {
    const prompt = buildSourceInventoryPrompt(await paper29Pages())
    const parsed = JSON.parse(prompt)
    expect(parsed.candidates.some(candidate => candidate.caption === true && candidate.text.startsWith('Figure'))).toBe(true)
    expect(prompt).not.toContain('mediaReaderPages')
  })
})

describe('buildTranslationPrompt machine-consumed structure', () => {
  it('serializes purpose translation with the exact sourceId and only eligible units', async () => {
    // Given an application-validated source inventory.
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    const eligible = source.units.filter(isTranslationEligible)
    // When the builder filters the partition to the requested eligible batch ids.
    const parsed = z.object({
      purpose: z.literal('translation'),
      sourceId: z.string(),
      units: z.array(z.object({ kind: z.enum(['paragraph', 'heading', 'caption']) }).passthrough()),
    }).passthrough().parse(JSON.parse(buildTranslationPrompt(source, eligible.map(unit => unit.id))))
    // Then the machine tokens and the eligible-only partition survive.
    expect(parsed.purpose).toBe('translation')
    expect(parsed.sourceId).toBe(source.sourceId)
    expect(parsed.units.map(unit => unit.kind)).toEqual(eligible.map(unit => unit.kind))
  })
})

describe('buildSourceReviewPrompt machine-consumed structure', () => {
  it('serializes purpose source-review with the global digest and only the batch subset', async () => {
    // Given a frozen whole-source/pairs snapshot, including excluded and preserved units.
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    const pairs = source.units.filter(isTranslationEligible).map(unit => ({ unitId: unit.id, chinese: '校准译文。' }))
    const frozen = freezePaperTranslation(source, pairs)
    const expectedIds = source.units.map(unit => unit.id)
    // When the builder renders the review request for one batch.
    const parsed = z.object({
      purpose: z.literal('source-review'),
      reviewOf: z.string(),
      expectedIds: z.array(z.string()),
      units: z.array(z.object({ id: z.string(), kind: z.string(), original: z.string() }).passthrough()),
      pairs: z.array(z.object({ unitId: z.string() }).passthrough()),
    }).passthrough().parse(JSON.parse(buildSourceReviewPrompt(frozen, expectedIds)))
    // Then the global digest and expected ids survive, but the payload is the
    // compact batch subset — not the whole source/pairs snapshot.
    expect(parsed.purpose).toBe('source-review')
    expect(parsed.reviewOf).toBe(frozen.reviewOf)
    expect(parsed.expectedIds).toEqual(expectedIds)
    expect(parsed.units.map(unit => unit.id)).toEqual(expectedIds)
    expect(parsed.pairs.map(pair => pair.unitId)).toEqual(pairs.map(pair => pair.unitId))
    expect(parsed.units.length).toBeLessThanOrEqual(40)
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(24000)
  })

  it('emits a batch subset that never includes out-of-batch originals or pairs', async () => {
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify(paper29Inventory(pages)))
    const pairs = source.units.filter(isTranslationEligible).map(unit => ({ unitId: unit.id, chinese: '校准译文。' }))
    const frozen = freezePaperTranslation(source, pairs)
    const batchIds = source.units.slice(0, 2).map(unit => unit.id)
    // When the builder renders a review request for only the first batch.
    const parsed = z.object({ units: z.array(z.any()), pairs: z.array(z.any()) }).parse(JSON.parse(buildSourceReviewPrompt(frozen, batchIds)))
    // Then only the assigned units and their pairs are present; the global digest is unchanged.
    expect(parsed.units.map(unit => unit.id)).toEqual(batchIds)
    expect(new Set(parsed.units.map(unit => unit.id)).size).toBe(batchIds.length)
    expect(parsed.pairs.every(pair => batchIds.includes(pair.unitId))).toBe(true)
    expect(JSON.parse(buildSourceReviewPrompt(frozen, batchIds)).reviewOf).toBe(frozen.reviewOf)
  })
})