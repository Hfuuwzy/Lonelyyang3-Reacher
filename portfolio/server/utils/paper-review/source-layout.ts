import type { ExtractedPaperPage } from './pdf'
import type { PaperReviewTaskGap } from '../../../app/utils/paper-review-task-contract'

export interface PaperTextRun {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly horizontal: boolean
}

export function layoutGaps(pages: readonly ExtractedPaperPage[]): readonly PaperReviewTaskGap[] {
  return pages.flatMap(page => {
    const runs = page.textRuns
    let code = ''
    if (page.text.trim() === '') code = 'empty-page'
    else if (!runs || runs.length === 0) code = 'geometry-unavailable'
    else if (runs.some((run, index) => {
      if (!run.horizontal || ![run.x, run.y, run.width].every(Number.isFinite)) return true
      const previous = runs[index - 1]
      if (previous && run.y > previous.y + 2) return true
      return runs.some(other => Math.abs(other.y - run.y) <= 2 && other.x - (run.x + run.width) > 48)
    })) code = 'layout-ambiguity'
    if (!code) return []
    return [{ artifact: 'source' as const, code, origin: 'application' as const, unitIds: [],
      readerPages: [page.readerPage],
      spans: page.lines.map((line, lineIndex) => ({ readerPage: page.readerPage, lineIndex, start: 0, end: line.text.length })),
      reason: `Source extraction requires inspection: ${code}. No OCR or reading-order repair was attempted.`,
    }]
  })
}
