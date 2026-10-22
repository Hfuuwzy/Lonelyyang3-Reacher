import { describe, expect, it } from 'vitest'
import type { PaperReviewTaskResult } from '../../app/utils/paper-review-task-contract'
import {
  clearPaperReviewResultState,
  createPaperReviewResultState,
} from '../../app/utils/paper-review-result-state'

const RESULT: PaperReviewTaskResult = {
  status: 'complete',
  provider: 'fixture-provider',
  model: 'fixture-model',
  source: { sourceId: 'fixed-29', pageCount: 1, units: [] },
  report: { sections: [], gaps: [] },
  translation: { pairs: [], review: { reviewOf: 'u-2', status: 'passed', checks: [] } },
  gaps: [],
}

function pdfFile(name: string): File {
  return new File(['pdf-bytes'], name, { type: 'application/pdf' })
}

describe('createPaperReviewResultState', () => {
  it('binds the submitted PDF name and a fresh object URL created from the exact file', () => {
    const created: string[] = []
    const state = createPaperReviewResultState(pdfFile('survey.pdf'), RESULT, (file) => {
      expect(file.name).toBe('survey.pdf')
      created.push('blob:one')
      return 'blob:one'
    })
    expect(state.pdfName).toBe('survey.pdf')
    expect(state.pdfUrl).toBe('blob:one')
    expect(state.result).toBe(RESULT)
    expect(created).toEqual(['blob:one'])
  })

  it('falls back to the generic label for a nameless submitted file', () => {
    const state = createPaperReviewResultState(new File(['x'], ''), RESULT, () => 'blob:url')
    expect(state.pdfName).toBe('论文')
  })

  it('keeps an earlier adopted state bound to its own file and URL when a newer file is selected', () => {
    const first = createPaperReviewResultState(pdfFile('one.pdf'), RESULT, () => 'blob:first')
    const second = createPaperReviewResultState(pdfFile('two.pdf'), RESULT, () => 'blob:second')
    expect(first.pdfName).toBe('one.pdf')
    expect(first.pdfUrl).toBe('blob:first')
    expect(second.pdfName).toBe('two.pdf')
    expect(second.pdfUrl).toBe('blob:second')
    expect(first.pdfUrl).not.toBe(second.pdfUrl)
  })
})

describe('clearPaperReviewResultState', () => {
  it('revokes the owned object URL exactly once and returns null', () => {
    const revoked: string[] = []
    const state = createPaperReviewResultState(pdfFile('one.pdf'), RESULT, () => 'blob:owned')
    const next = clearPaperReviewResultState(state, (url) => {
      revoked.push(url)
    })
    expect(revoked).toEqual(['blob:owned'])
    expect(next).toBeNull()
  })

  it('revokes only the replaced state URL when a submission is replaced', () => {
    const revoked: string[] = []
    const first = createPaperReviewResultState(pdfFile('one.pdf'), RESULT, () => 'blob:one')
    clearPaperReviewResultState(first, (url) => {
      revoked.push(url)
    })
    const second = createPaperReviewResultState(pdfFile('two.pdf'), RESULT, () => 'blob:two')
    expect(revoked).toEqual(['blob:one'])
    expect(second.pdfUrl).toBe('blob:two')
  })

  it('does not revoke when there is nothing adopted', () => {
    const revoked: string[] = []
    expect(clearPaperReviewResultState(null, (url) => {
      revoked.push(url)
    })).toBeNull()
    expect(revoked).toEqual([])
  })
})