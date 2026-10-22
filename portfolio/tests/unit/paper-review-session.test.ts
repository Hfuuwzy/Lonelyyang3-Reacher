import { describe, expect, it } from 'vitest'
import type { PaperReviewTaskResult } from '../../app/utils/paper-review-task-contract'
import {
  createPaperReviewSession,
  type PaperReviewObjectUrlAdapter,
} from '../../app/composables/paper-review-session'

const RESULT: PaperReviewTaskResult = {
  status: 'complete',
  provider: 'fixture-provider',
  model: 'fixture-model',
  source: { sourceId: 'fixture', pageCount: 1, units: [] },
  report: { sections: [], gaps: [] },
  translation: { pairs: [], review: { reviewOf: '', status: 'passed', checks: [] } },
  gaps: [],
}

function pdfFile(name: string): File {
  return new File(['pdf-bytes'], name, { type: 'application/pdf' })
}

function recordingAdapter(): { adapter: PaperReviewObjectUrlAdapter; created: string[]; revoked: string[] } {
  const created: string[] = []
  const revoked: string[] = []
  let counter = 0
  return {
    created,
    revoked,
    adapter: {
      create: (file) => {
        counter += 1
        created.push(file.name)
        return `blob:${counter}`
      },
      revoke: (url) => {
        revoked.push(url)
      },
    },
  }
}

describe('createPaperReviewSession lifecycle', () => {
  it('adopt exposes the result, pdf name, and object URL to readers', () => {
    const { adapter } = recordingAdapter()
    const session = createPaperReviewSession(adapter)
    session.adopt(RESULT, pdfFile('survey.pdf'))
    expect(session.result.value).toEqual(RESULT)
    expect(session.pdfUrl.value).toBe('blob:1')
    expect(session.pdfName.value).toBe('survey.pdf')
  })

  it('falls back to the generic label for a nameless file', () => {
    const session = createPaperReviewSession(recordingAdapter().adapter)
    session.adopt(RESULT, new File(['x'], ''))
    expect(session.pdfName.value).toBe('论文')
  })

  it('replacing the result revokes the previous object URL exactly once', () => {
    const { adapter, created, revoked } = recordingAdapter()
    const session = createPaperReviewSession(adapter)
    session.adopt(RESULT, pdfFile('one.pdf'))
    session.adopt(RESULT, pdfFile('two.pdf'))
    expect(created).toEqual(['one.pdf', 'two.pdf'])
    expect(revoked).toEqual(['blob:1'])
    expect(session.pdfUrl.value).toBe('blob:2')
    expect(session.pdfName.value).toBe('two.pdf')
  })

  it('clear revokes the owned URL and leaves readers with no result', () => {
    const { adapter, revoked } = recordingAdapter()
    const session = createPaperReviewSession(adapter)
    session.adopt(RESULT, pdfFile('one.pdf'))
    session.clear()
    expect(revoked).toEqual(['blob:1'])
    expect(session.result.value).toBeNull()
    expect(session.pdfUrl.value).toBeNull()
  })

  it('clear and adopt-after-clear never revoke a stale URL', () => {
    const { adapter, revoked } = recordingAdapter()
    const session = createPaperReviewSession(adapter)
    session.clear()
    session.adopt(RESULT, pdfFile('one.pdf'))
    session.clear()
    expect(revoked).toEqual(['blob:1'])
  })

  it('a fresh session exposes no result before any adoption', () => {
    const session = createPaperReviewSession(recordingAdapter().adapter)
    expect(session.result.value).toBeNull()
    expect(session.pdfUrl.value).toBeNull()
    expect(session.pdfName.value).toBe('论文')
  })
})