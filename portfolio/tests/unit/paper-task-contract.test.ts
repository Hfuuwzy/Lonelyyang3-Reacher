import { describe, expect, it } from 'vitest'
import {
  PAPER_TASK_OUTCOMES,
  PAPER_TASK_STATES,
  getSelectedBranches,
  initialBranchStates,
  paperTaskActionResultSchema,
  paperTaskEventSchema,
  validatePaperTaskEvent,
} from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'

function accepted(selection: 'translation' | 'deep-reading' | 'both', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'accepted', taskId: TASK_ID, selection, ...overrides }
}

function progress(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'progress', taskId: TASK_ID, stage: 'generating', branch: 'translation', completed: 1, total: 3,
    ...overrides,
  }
}

function preview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'preview', taskId: TASK_ID, branch: 'translation', designation: 'sample', paragraphs: ['第一段样例译文。'],
    ...overrides,
  }
}

function terminal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'terminal', taskId: TASK_ID, outcome: 'succeeded',
    branches: { translation: 'sample-ready', 'deep-reading': 'not-selected' },
    cleanup: 'clean',
    ...overrides,
  }
}

describe('getSelectedBranches', () => {
  it.each([
    ['translation', ['translation']],
    ['deep-reading', ['deep-reading']],
    ['both', ['translation', 'deep-reading']],
  ] as const)('activates %s only', (selection, expected) => {
    expect(getSelectedBranches(selection)).toEqual(expected)
  })
})

describe('initialBranchStates', () => {
  it('starts the translation branch pending and deep-reading not-selected', () => {
    expect(initialBranchStates('translation')).toEqual({ translation: 'pending', 'deep-reading': 'not-selected' })
  })

  it('starts the deep-reading branch pending and translation not-selected', () => {
    expect(initialBranchStates('deep-reading')).toEqual({ translation: 'not-selected', 'deep-reading': 'pending' })
  })

  it('starts both branches pending for a both selection', () => {
    expect(initialBranchStates('both')).toEqual({ translation: 'pending', 'deep-reading': 'pending' })
  })
})

describe('validatePaperTaskEvent - accepted', () => {
  it('accepts an accepted echo whose selection matches the request', () => {
    expect(validatePaperTaskEvent(accepted('both'), 'both')).toBe(true)
  })

  it('rejects an accepted echo for a different selection', () => {
    expect(validatePaperTaskEvent(accepted('translation'), 'both')).toBe(false)
  })

  it('rejects a non-uuid task id', () => {
    expect(validatePaperTaskEvent(accepted('translation', { taskId: 'not-a-uuid' }), 'translation')).toBe(false)
  })
})

describe('validatePaperTaskEvent - progress', () => {
  it('accepts a progress event for a selected branch', () => {
    expect(validatePaperTaskEvent(progress(), 'translation')).toBe(true)
  })

  it('accepts a whole-task progress event with a null branch', () => {
    expect(validatePaperTaskEvent(progress({ branch: null }), 'translation')).toBe(true)
  })

  it('rejects an unselected branch that reports progress', () => {
    expect(validatePaperTaskEvent(progress({ branch: 'deep-reading' }), 'translation')).toBe(false)
  })

  it('accepts a progress event with zero completed and a positive total', () => {
    expect(validatePaperTaskEvent(progress({ completed: 0 }), 'translation')).toBe(true)
  })

  it.each([
    ['zero total', { total: 0 }],
    ['completed beyond total', { completed: 4 }],
    ['fractional completed', { completed: 1.5 }],
  ] as const)('rejects %s progress', (_label, overrides) => {
    expect(validatePaperTaskEvent(progress(overrides), 'translation')).toBe(false)
  })
})

describe('validatePaperTaskEvent - preview (selected-only, never complete)', () => {
  it('accepts a sample-designated preview for a selected branch', () => {
    expect(validatePaperTaskEvent(preview(), 'translation')).toBe(true)
  })

  it('rejects a preview falsely claiming a completed design', () => {
    const falsified = preview({ designation: 'complete' })
    expect(validatePaperTaskEvent(falsified, 'translation')).toBe(false)
    expect(paperTaskEventSchema.safeParse(falsified).success).toBe(false)
  })

  it('rejects a preview falsely claiming quality passed', () => {
    expect(validatePaperTaskEvent(preview({ designation: 'passed' }), 'translation')).toBe(false)
  })

  it('rejects a preview with no designation at all', () => {
    const missing = preview()
    delete missing.designation
    expect(validatePaperTaskEvent(missing, 'translation')).toBe(false)
  })

  it('rejects a preview for an unselected branch', () => {
    expect(validatePaperTaskEvent(preview({ branch: 'deep-reading' }), 'translation')).toBe(false)
  })

  it('rejects a preview on a non-branch value', () => {
    expect(validatePaperTaskEvent(preview({ branch: 'both' }), 'both')).toBe(false)
  })

  it('rejects a preview with no paragraphs', () => {
    expect(validatePaperTaskEvent(preview({ paragraphs: [] }), 'translation')).toBe(false)
  })

  it('rejects a preview with paragraphs past the bounded count', () => {
    const paragraphs = Array.from({ length: 9 }, (_, index) => `第 ${index + 1} 段。`)
    expect(validatePaperTaskEvent(preview({ paragraphs }), 'translation')).toBe(false)
  })

  it('rejects a preview with an over-long paragraph', () => {
    expect(validatePaperTaskEvent(preview({ paragraphs: ['x'.repeat(2001)] }), 'translation')).toBe(false)
  })
})

describe('validatePaperTaskEvent - terminal', () => {
  it('accepts a succeeded terminal for the selected branch', () => {
    expect(validatePaperTaskEvent(terminal(), 'translation')).toBe(true)
  })

  it('accepts a failed terminal that still reports the sibling sample-ready', () => {
    const failed = terminal({ outcome: 'failed', branches: { translation: 'failed', 'deep-reading': 'sample-ready' } })
    expect(validatePaperTaskEvent(failed, 'both')).toBe(true)
  })

  it('rejects a terminal that marks an unselected branch as anything but not-selected', () => {
    const masked = terminal({ branches: { translation: 'sample-ready', 'deep-reading': 'sample-ready' } })
    expect(validatePaperTaskEvent(masked, 'translation')).toBe(false)
  })

  it('rejects a terminal that leaves a selected branch not-selected', () => {
    const unstarted = terminal({ branches: { translation: 'not-selected', 'deep-reading': 'not-selected' } })
    expect(validatePaperTaskEvent(unstarted, 'both')).toBe(false)
  })

  it('rejects a succeeded terminal with an in-flight or failed branch', () => {
    expect(validatePaperTaskEvent(terminal({ branches: { translation: 'running', 'deep-reading': 'not-selected' } }), 'translation')).toBe(false)
    expect(validatePaperTaskEvent(terminal({ branches: { translation: 'failed', 'deep-reading': 'not-selected' } }), 'translation')).toBe(false)
  })

  it('accepts a cancelled terminal whose unfinished sibling is cancelled, and one with a failed sibling', () => {
    const cancelled = terminal({ outcome: 'cancelled', branches: { translation: 'cancelled', 'deep-reading': 'sample-ready' } })
    expect(validatePaperTaskEvent(cancelled, 'both')).toBe(true)
    const withFailed = terminal({ outcome: 'cancelled', branches: { translation: 'cancelled', 'deep-reading': 'failed' } })
    expect(validatePaperTaskEvent(withFailed, 'both')).toBe(true)
  })

  it('accepts a cancelled terminal that happened during cleanup with every sample retained', () => {
    const duringCleanup = terminal({ outcome: 'cancelled', branches: { translation: 'sample-ready', 'deep-reading': 'sample-ready' } })
    expect(validatePaperTaskEvent(duringCleanup, 'both')).toBe(true)
  })

  it('rejects a cancelled terminal with an in-flight or not-selected selected branch', () => {
    expect(validatePaperTaskEvent(terminal({ outcome: 'cancelled', branches: { translation: 'running', 'deep-reading': 'sample-ready' } }), 'both')).toBe(false)
    expect(validatePaperTaskEvent(terminal({ outcome: 'cancelled', branches: { translation: 'pending', 'deep-reading': 'sample-ready' } }), 'both')).toBe(false)
    expect(validatePaperTaskEvent(terminal({ outcome: 'cancelled', branches: { translation: 'not-selected', 'deep-reading': 'sample-ready' } }), 'both')).toBe(false)
  })

  it('requires a disconnected terminal to mark unfinished branches cancelled, never in-flight', () => {
    const unfinishedCancelled = terminal({ outcome: 'disconnected', branches: { translation: 'cancelled', 'deep-reading': 'cancelled' } })
    expect(validatePaperTaskEvent(unfinishedCancelled, 'both')).toBe(true)
    const inFlight = terminal({ outcome: 'disconnected', branches: { translation: 'running', 'deep-reading': 'running' } })
    expect(validatePaperTaskEvent(inFlight, 'both')).toBe(false)
    const pending = terminal({ outcome: 'disconnected', branches: { translation: 'pending', 'deep-reading': 'sample-ready' } })
    expect(validatePaperTaskEvent(pending, 'both')).toBe(false)
  })

  it('accepts a disconnected terminal with a failed or sample-ready branch alongside cancelled ones', () => {
    const mixed = terminal({ outcome: 'disconnected', branches: { translation: 'cancelled', 'deep-reading': 'failed' } })
    expect(validatePaperTaskEvent(mixed, 'both')).toBe(true)
    const retained = terminal({ outcome: 'disconnected', branches: { translation: 'sample-ready', 'deep-reading': 'cancelled' } })
    expect(validatePaperTaskEvent(retained, 'both')).toBe(true)
  })

  it('rejects an unknown outcome or cleanup value', () => {
    expect(validatePaperTaskEvent(terminal({ outcome: 'complete' }), 'translation')).toBe(false)
    expect(validatePaperTaskEvent(terminal({ cleanup: 'pending' }), 'translation')).toBe(false)
  })
})

describe('paperTaskActionResultSchema - discriminated valid combinations', () => {
  it.each([
    ['stopped with ok', { ok: true, code: 'stopped' }],
    ['deleted with ok', { ok: true, code: 'deleted' }],
    ['cleanup-failed without ok', { ok: false, code: 'cleanup-failed' }],
    ['not-found without ok', { ok: false, code: 'not-found' }],
  ] as const)('accepts %s', (_label, result) => {
    expect(paperTaskActionResultSchema.safeParse(result).success).toBe(true)
  })

  it.each([
    ['not-found marked ok', { ok: true, code: 'not-found' }],
    ['deleted marked failed', { ok: false, code: 'deleted' }],
    ['stopped marked failed', { ok: false, code: 'stopped' }],
    ['cleanup-failed marked ok', { ok: true, code: 'cleanup-failed' }],
    ['unknown code', { ok: true, code: 'purged' }],
    ['string ok', { ok: 'yes', code: 'stopped' }],
  ] as const)('rejects %s', (_label, result) => {
    expect(paperTaskActionResultSchema.safeParse(result).success).toBe(false)
  })
})

describe('no complete/passed quality status on the wire', () => {
  it('keeps complete and passed out of the state and outcome vocabularies', () => {
    for (const word of ['complete', 'passed']) {
      expect(PAPER_TASK_STATES).not.toContain(word)
      expect(PAPER_TASK_OUTCOMES).not.toContain(word)
    }
  })
})