import { describe, expect, it } from 'vitest'
import { evaluateFormatGate } from '../../server/paper-task/format-gate'
import type { PaperTaskFormatState } from '../../server/paper-task/format-gate'

const HASH = 'a'.repeat(64)

function builtState(overrides: Partial<PaperTaskFormatState> = {}): PaperTaskFormatState {
  return {
    format: 'pdf',
    build: 'built',
    masterQuality: 'complete',
    sourceMasterSha256: HASH,
    artifactMasterSha256: HASH,
    expectedPageCount: 2,
    pages: [{ page: 1, status: 'passed' }, { page: 2, status: 'passed' }],
    ...overrides,
  }
}

describe('paper task format quality gate', () => {
  it('completes markdown with a matching master and no blockers', () => {
    expect(evaluateFormatGate(builtState({ format: 'markdown' }))).toEqual({ status: 'complete', issues: [] })
  })

  it('completes pdf with exact passed page evidence', () => {
    expect(evaluateFormatGate(builtState())).toEqual({ status: 'complete', issues: [] })
  })

  it('accepts minor page checks', () => {
    expect(evaluateFormatGate(builtState({ pages: [{ page: 1, status: 'minor' }, { page: 2, status: 'passed' }] })))
      .toEqual({ status: 'complete', issues: [] })
  })

  it('requires confirmation when a page is blocked', () => {
    expect(evaluateFormatGate(builtState({ pages: [{ page: 1, status: 'passed' }, { page: 2, status: 'blocked' }] })).status)
      .toBe('needs-confirmation')
  })

  it('requires confirmation when a page is missing', () => {
    expect(evaluateFormatGate(builtState({ pages: [{ page: 1, status: 'passed' }] })).status).toBe('needs-confirmation')
  })

  it('requires confirmation for duplicate pages', () => {
    expect(evaluateFormatGate(builtState({ pages: [{ page: 1, status: 'passed' }, { page: 1, status: 'passed' }] })).status)
      .toBe('needs-confirmation')
  })

  it('requires confirmation for out-of-range pages', () => {
    expect(evaluateFormatGate(builtState({ pages: [{ page: 1, status: 'passed' }, { page: 3, status: 'passed' }] })).status)
      .toBe('needs-confirmation')
  })

  it('does not treat a successful build as page evidence', () => {
    expect(evaluateFormatGate(builtState({ pages: undefined })).status).toBe('needs-confirmation')
  })

  it('does not exceed a master that needs confirmation', () => {
    expect(evaluateFormatGate(builtState({ masterQuality: 'needs-confirmation' })).status).toBe('needs-confirmation')
  })

  it('keeps a preview master at preview', () => {
    expect(evaluateFormatGate(builtState({ masterQuality: 'preview' })).status).toBe('preview')
  })

  it('fails when the build failed', () => {
    expect(evaluateFormatGate(builtState({ build: 'failed' })).status).toBe('failed')
  })

  it('fails on a hash mismatch or missing hash', () => {
    expect(evaluateFormatGate(builtState({ artifactMasterSha256: 'b'.repeat(64) }))).toEqual({
      status: 'failed',
      issues: ['artifact-does-not-match-approved-master'],
    })
    expect(evaluateFormatGate(builtState({ sourceMasterSha256: undefined })).status).toBe('failed')
  })

  it('requires confirmation for non-empty blockers', () => {
    expect(evaluateFormatGate(builtState({ blockers: ['missing figure'] })).status).toBe('needs-confirmation')
  })

  it('keeps an unbuilt format at preview', () => {
    expect(evaluateFormatGate(builtState({ build: 'unbuilt' })).status).toBe('preview')
  })

  it('requires confirmation for an invalid page count or an empty evidence list', () => {
    expect(evaluateFormatGate(builtState({ expectedPageCount: 0 })).status).toBe('needs-confirmation')
    expect(evaluateFormatGate(builtState({ pages: [] })).status).toBe('needs-confirmation')
  })
})
