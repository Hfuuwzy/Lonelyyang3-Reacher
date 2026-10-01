import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildPaperReviewPrompt, buildSourceInventoryPrompt, buildSourceReviewPrompt, buildTranslationPrompt } from '../../server/utils/paper-review/prompt'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { paper29Groups, paper29Pages } from '../fixtures/paper-review-29'
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

  it('shows the page\'s own heading when the page opens with one', () => {
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
})

describe('buildSourceInventoryPrompt machine-consumed structure', () => {
  it('serializes purpose inventory with application source-line structure', async () => {
    // Given real extracted pages resolved through the application source ledger.
    const pages = await paper29Pages()
    // When the purpose-specific builder renders the inventory request as JSON.
    const parsed = z.object({
      purpose: z.literal('inventory'),
      source: z.array(z.object({
        span: z.object({
          readerPage: z.number(),
          lineIndex: z.number(),
          start: z.number(),
          end: z.number(),
        }),
        text: z.string(),
        heading: z.string(),
        exclusion: z.object({ reason: z.enum(['bibliography', 'appendix']) }).optional(),
      }).passthrough()),
    }).passthrough().parse(JSON.parse(buildSourceInventoryPrompt(pages)))
    // Then the machine token and the app-owned ledger structure survive.
    expect(parsed.purpose).toBe('inventory')
    expect(parsed.source).toHaveLength(pages.reduce((count, page) => count + page.lines.length, 0))
    const introduction = parsed.source.find(line => line.span.readerPage === 1 && line.span.lineIndex === 0)
    expect(introduction).toMatchObject({ text: '1 Introduction', heading: '1 Introduction' })
    const bibliography = parsed.source.find(line => line.exclusion?.reason === 'bibliography')
    expect(bibliography?.text).toBe('References')
  })
})

describe('buildTranslationPrompt machine-consumed structure', () => {
  it('serializes purpose translation with the exact sourceId and only eligible units', async () => {
    // Given an application-validated source inventory.
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages) }))
    // When the builder filters the partition to translation-eligible units.
    const parsed = z.object({
      purpose: z.literal('translation'),
      sourceId: z.string(),
      units: z.array(z.object({ kind: z.enum(['paragraph', 'heading', 'caption']) }).passthrough()),
    }).passthrough().parse(JSON.parse(buildTranslationPrompt(source)))
    const eligible = source.units.filter(isTranslationEligible)
    // Then the machine tokens and the eligible-only partition survive.
    expect(parsed.purpose).toBe('translation')
    expect(parsed.sourceId).toBe(source.sourceId)
    expect(parsed.units.map(unit => unit.kind)).toEqual(eligible.map(unit => unit.kind))
  })
})

describe('buildSourceReviewPrompt machine-consumed structure', () => {
  it('serializes purpose source-review with the frozen fingerprint, source, and pairs', async () => {
    // Given a frozen source/pair snapshot, including excluded and preserved units.
    const pages = await paper29Pages()
    const { source } = validateSourceInventory(pages, JSON.stringify({ units: paper29Groups(pages) }))
    const pairs = source.units.filter(isTranslationEligible).map(unit => ({ unitId: unit.id, chinese: '校准译文。' }))
    const frozen = freezePaperTranslation(source, pairs)
    // When the builder renders the review request.
    const parsed = z.object({
      purpose: z.literal('source-review'),
      reviewOf: z.string(),
      source: z.unknown(),
      pairs: z.unknown(),
    }).passthrough().parse(JSON.parse(buildSourceReviewPrompt(frozen)))
    // Then the exact frozen fingerprint and serialized source/pairs survive.
    expect(parsed.purpose).toBe('source-review')
    expect(parsed.reviewOf).toBe(frozen.reviewOf)
    expect(parsed.source).toEqual(frozen.source)
    expect(parsed.pairs).toEqual(frozen.pairs)
  })
})
