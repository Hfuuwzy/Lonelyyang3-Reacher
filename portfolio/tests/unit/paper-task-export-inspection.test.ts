import { describe, expect, it } from 'vitest'
import { createPaperTaskInspectionDrafts } from '../../app/utils/paper-task-export-inspection'

describe('paper-task PDF inspection drafts', () => {
  it('leaves every unchecked page without a conclusion rather than defaulting to passed', () => {
    expect(createPaperTaskInspectionDrafts(2, [])).toEqual([
      { page: 1, status: '', expected: '', observed: '', evidence: '' },
      { page: 2, status: '', expected: '', observed: '', evidence: '' },
    ])
  })

  it('preserves saved page conclusions and initializes only missing pages as blocked', () => {
    expect(createPaperTaskInspectionDrafts(2, [{
      page: 1,
      status: 'minor',
      expected: 'Heading and table are visible.',
      observed: 'Heading is visible; table wraps slightly.',
      evidence: 'Inspected the retained PDF, page 1.',
    }])).toEqual([
      {
        page: 1,
        status: 'minor',
        expected: 'Heading and table are visible.',
        observed: 'Heading is visible; table wraps slightly.',
        evidence: 'Inspected the retained PDF, page 1.',
      },
      { page: 2, status: '', expected: '', observed: '', evidence: '' },
    ])
  })
})
