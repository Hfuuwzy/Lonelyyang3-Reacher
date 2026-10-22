import { describe, expect, it } from 'vitest'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { buildSourceCandidates, MAX_CANDIDATE_SERIALIZED_CHARS } from '../../server/utils/paper-review/source-candidate'
import { validateSourceInventory } from '../../server/utils/paper-review/source-inventory'
import { sourceLines } from '../../server/utils/paper-review/source-ledger'
import {
  codebertCapturedPage,
  codebertPage5Lines,
} from '../fixtures/paper-review-codebert'

const codebertPages = (): readonly ExtractedPaperPage[] => [codebertCapturedPage(5), codebertCapturedPage(7), codebertCapturedPage(10)]

function classifyAll(pages: readonly ExtractedPaperPage[]) {
  return buildSourceCandidates(pages).map((candidate) =>
    candidate.exclusion !== undefined
      ? { candidateId: candidate.id, kind: 'excluded', reason: candidate.exclusion.reason }
      : candidate.caption
        ? { candidateId: candidate.id, kind: 'caption' }
        : candidate.preserved !== undefined
          ? { candidateId: candidate.id, kind: 'preserved-original', reason: candidate.preserved }
          : candidate.headingCandidate
            ? { candidateId: candidate.id, kind: 'heading' }
            : candidate.ambiguous
              ? { candidateId: candidate.id, kind: 'unresolved' }
              : { candidateId: candidate.id, kind: 'paragraph' })
}

describe('CodeBERT captured source candidates (no network)', () => {
  it('covers every non-blank character of every captured page exactly once across all roles', () => {
    const pages = codebertPages()
    const candidates = buildSourceCandidates(pages)
    for (const page of pages) {
      for (const [lineIndex, line] of page.lines.entries()) {
        for (let offset = 0; offset < line.text.length; offset += 1) {
          if (/\s/.test(line.text.charAt(offset))) {
            continue
          }
          const owners = candidates.flatMap((candidate) => candidate.spans)
            .filter((span) => span.readerPage === page.readerPage && span.lineIndex === lineIndex && span.start <= offset && span.end > offset)
          expect(owners).toHaveLength(1)
        }
      }
    }
  })

  it('bounds every candidate record, including long excluded/preserved blocks', () => {
    const candidates = buildSourceCandidates(codebertPages())
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const serialized = JSON.stringify({ id: candidate.id, text: candidate.text }).length
      expect(serialized).toBeLessThanOrEqual(MAX_CANDIDATE_SERIALIZED_CHARS + 64)
    }
  })

  it('recognises real CodeBERT headings and never a metric/author row', () => {
    const pages = codebertPages()
    const candidates = buildSourceCandidates(pages)
    const headingTexts = candidates.filter((candidate) => candidate.headingCandidate).map((candidate) => candidate.text)
    expect(headingTexts).toEqual(expect.arrayContaining([
      '4.1 Natural Language Code Search',
      '3.5 Fine-Tuning CodeBERT',
      '4 Experiment',
      '4.3 Code Documentation Generation',
    ]))
    // A metric row such as the CodeBERT probing numbers is never a heading.
    for (const candidate of candidates) {
      expect(candidate.headingCandidate && /^[\d.]+\s[\d.]+/.test(candidate.text)).toBe(false)
    }
  })

  it('classifies the captured pages into an exhaustive, ordered inventory', () => {
    const pages = codebertPages()
    const result = validateSourceInventory(pages, JSON.stringify(classifyAll(pages)))
    expect(result.gaps.filter((gap) => gap.code !== 'unresolved-source')).toEqual([])
    const allSpans = result.source.units.flatMap((unit) => unit.spans)
    const unique = new Set(allSpans.map((span) => `${span.readerPage}:${span.lineIndex}:${span.start}-${span.end}`))
    expect(unique.size).toBe(allSpans.length)
  })

  it('anchors Appendix A before Appendix B and keeps titled appendix scope after bibliography', () => {
    const pages = codebertPages()
    const ledger = sourceLines(pages)
    const dataStatistic = ledger.find((line) => line.text.trim() === 'A Data Statistic')
    const trainDetails = ledger.find((line) => line.text.trim() === 'B Train Details')
    expect(dataStatistic?.exclusion?.reason).toBe('appendix')
    expect(trainDetails?.exclusion?.reason).toBe('appendix')
    const units = validateSourceInventory(pages, JSON.stringify(classifyAll(pages))).source.units
    const appendixText = units
      .filter((unit) => unit.kind === 'excluded' && unit.reason === 'appendix')
      .map((unit) => unit.original)
      .join('\n')
    const aPos = appendixText.indexOf('A Data Statistic')
    const bPos = appendixText.indexOf('B Train Details')
    expect(aPos).toBeGreaterThan(-1)
    expect(bPos).toBeGreaterThan(aPos)
  })

  it('keeps page 5 column-local headings inside their column candidates', () => {
    const pages = codebertPages()
    const ledger = sourceLines(pages)
    const heading = ledger.find((line) => line.text.trim() === '3.5 Fine-Tuning CodeBERT')
    expect(heading?.column).toBe(0)
    expect(codebertPage5Lines.find((line) => line.text === '4.1 Natural Language Code Search')?.column).toBe(1)
  })
})