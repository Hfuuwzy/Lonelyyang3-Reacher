import { describe, expect, it } from 'vitest'
import {
  parsePaperTaskMultipart,
  type PaperTaskMultipartPart,
} from '../../server/paper-task/multipart'
import {
  getSelectedBranches,
  initialBranchStates,
  paperTaskActionResultSchema,
  validatePaperTaskEvent,
  type PaperTaskEvent,
} from '../../app/utils/paper-task-contract'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])

function field(name: string, value: string): PaperTaskMultipartPart {
  return { name, data: new TextEncoder().encode(value) }
}

function pdf(overrides: { mime?: string; data?: Uint8Array; filename?: string } = {}): PaperTaskMultipartPart {
  return {
    name: 'pdf',
    filename: overrides.filename ?? 'paper.pdf',
    type: overrides.mime ?? 'application/pdf',
    data: overrides.data ?? PDF_BYTES,
  }
}

function validParts(): PaperTaskMultipartPart[] {
  return [pdf(), field('selection', 'translation')]
}

describe('parsePaperTaskMultipart — pdf + selection only', () => {
  it('parses a valid form into a typed input', () => {
    const result = parsePaperTaskMultipart(validParts(), 1024)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.input.pdf).toEqual(PDF_BYTES)
      expect(result.input.selection).toBe('translation')
    }
  })

  it('accepts both deep-reading and both selections', () => {
    for (const selection of ['deep-reading', 'both'] as const) {
      const result = parsePaperTaskMultipart([pdf(), field('selection', selection)], 1024)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.input.selection).toBe(selection)
      }
    }
  })

  it('accepts one arXiv source link with the selected branch and no uploaded file', () => {
    const result = parsePaperTaskMultipart([
      field('sourceUrl', 'https://arxiv.org/abs/2404.05961'),
      field('selection', 'deep-reading'),
    ], 1024)

    expect(result).toEqual({
      success: true,
      input: { pdf: null, sourceUrl: 'https://arxiv.org/abs/2404.05961', selection: 'deep-reading' },
    })
  })

  it('rejects a request that supplies both a link and a PDF instead of choosing one source', () => {
    const result = parsePaperTaskMultipart([
      pdf(),
      field('sourceUrl', 'https://arxiv.org/abs/2404.05961'),
      field('selection', 'translation'),
    ], 1024)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('multiple-sources')
  })

  it('rejects every field that is not pdf or selection', () => {
    for (const name of ['providerLabel', 'baseUrl', 'apiKey', 'protocol', 'model']) {
      const result = parsePaperTaskMultipart([...validParts(), field(name, 'secret')], 1024)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('unknown-field')
      }
    }
  })

  it('rejects an extra file and a duplicate pdf', () => {
    const extraFile = { name: 'notes', filename: 'notes.pdf', type: 'application/pdf', data: PDF_BYTES }
    const extra = parsePaperTaskMultipart([...validParts(), extraFile], 1024)
    expect(extra.success).toBe(false)
    if (!extra.success) {
      expect(extra.error.code).toBe('extra-file')
    }
    const duplicate = parsePaperTaskMultipart([...validParts(), pdf()], 1024)
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.error.code).toBe('duplicate-pdf')
    }
  })

  it('rejects a duplicate selection and an unknown text field', () => {
    const duplicate = parsePaperTaskMultipart([pdf(), field('selection', 'translation'), field('selection', 'both')], 1024)
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) {
      expect(duplicate.error.code).toBe('duplicate-field')
    }
    const unknown = parsePaperTaskMultipart([pdf(), field('bogus', 'x')], 1024)
    expect(unknown.success).toBe(false)
    if (!unknown.success) {
      expect(unknown.error.code).toBe('unknown-field')
    }
  })

  it('rejects a missing source, a missing selection, and an invalid selection', () => {
    const missingPdf = parsePaperTaskMultipart([field('selection', 'translation')], 1024)
    expect(missingPdf.success).toBe(false)
    if (!missingPdf.success) {
      expect(missingPdf.error.code).toBe('missing-source')
    }
    const missingSelection = parsePaperTaskMultipart([pdf()], 1024)
    expect(missingSelection.success).toBe(false)
    if (!missingSelection.success) {
      expect(missingSelection.error.code).toBe('missing-selection')
    }
    const emptySelection = parsePaperTaskMultipart([pdf(), field('selection', '')], 1024)
    expect(emptySelection.success).toBe(false)
    if (!emptySelection.success) {
      expect(emptySelection.error.code).toBe('missing-selection')
    }
    for (const value of ['summary', 'translation+deep', 'TRANSLATION']) {
      const invalid = parsePaperTaskMultipart([pdf(), field('selection', value)], 1024)
      expect(invalid.success).toBe(false)
      if (!invalid.success) {
        expect(invalid.error.code).toBe('invalid-selection')
      }
    }
  })

  it('rejects an empty pdf, a non-PDF mime, a missing signature, and an oversized file', () => {
    const empty = parsePaperTaskMultipart([pdf({ data: new Uint8Array(0) }), field('selection', 'translation')], 1024)
    expect(empty.success).toBe(false)
    if (!empty.success) {
      expect(empty.error.code).toBe('empty-pdf')
    }
    const mime = parsePaperTaskMultipart([pdf({ mime: 'text/plain' }), field('selection', 'translation')], 1024)
    expect(mime.success).toBe(false)
    if (!mime.success) {
      expect(mime.error.code).toBe('invalid-mime')
    }
    const signature = parsePaperTaskMultipart([pdf({ data: new Uint8Array([1, 2, 3, 4]) }), field('selection', 'translation')], 1024)
    expect(signature.success).toBe(false)
    if (!signature.success) {
      expect(signature.error.code).toBe('invalid-signature')
    }
    const big = parsePaperTaskMultipart([pdf({ data: new Uint8Array(9) }), field('selection', 'translation')], 8)
    expect(big.success).toBe(false)
    if (!big.success) {
      expect(big.error.code).toBe('file-too-large')
    }
  })
})

describe('branch selection helpers', () => {
  it('activates only the selected branches and leaves unselected ones not-selected', () => {
    expect(getSelectedBranches('translation')).toEqual(['translation'])
    expect(getSelectedBranches('deep-reading')).toEqual(['deep-reading'])
    expect(getSelectedBranches('both')).toEqual(['translation', 'deep-reading'])
    expect(initialBranchStates('translation')).toEqual({ translation: 'pending', 'deep-reading': 'not-selected' })
    expect(initialBranchStates('both')).toEqual({ translation: 'pending', 'deep-reading': 'pending' })
  })
})

describe('paper task event validity across a terminal stream', () => {
  it('validates the full emitted stream for a both selection', () => {
    const taskId = '123e4567-e89b-12d3-a456-426614174000'
    const events: readonly PaperTaskEvent[] = [
      { type: 'accepted', taskId, selection: 'both' },
      { type: 'progress', taskId, stage: 'preparing', branch: null, completed: 0, total: 1 },
      { type: 'progress', taskId, stage: 'generating', branch: 'translation', completed: 0, total: 2 },
      { type: 'preview', taskId, branch: 'translation', designation: 'sample', paragraphs: ['样例译文。'] },
      { type: 'progress', taskId, stage: 'generating', branch: 'deep-reading', completed: 2, total: 2 },
      { type: 'progress', taskId, stage: 'cleaning', branch: null, completed: 0, total: 1 },
      {
        type: 'terminal',
        taskId,
        outcome: 'succeeded',
        branches: { translation: 'sample-ready', 'deep-reading': 'sample-ready' },
        cleanup: 'clean',
      },
    ]
    for (const event of events) {
      expect(validatePaperTaskEvent(event, 'both')).toBe(true)
    }
  })

  it('validates a cancelled terminal whose sibling finished sample-ready', () => {
    const event = {
      type: 'terminal',
      taskId: '123e4567-e89b-12d3-a456-426614174000',
      outcome: 'cancelled',
      branches: { translation: 'cancelled', 'deep-reading': 'sample-ready' },
      cleanup: 'clean',
    }
    expect(validatePaperTaskEvent(event, 'both')).toBe(true)
  })
})

describe('paperTaskActionResultSchema', () => {
  it('accepts only the four discriminated action results', () => {
    for (const result of [
      { ok: true, code: 'stopped' },
      { ok: true, code: 'deleted' },
      { ok: false, code: 'cleanup-failed' },
      { ok: false, code: 'not-found' },
    ]) {
      expect(paperTaskActionResultSchema.safeParse(result).success).toBe(true)
    }
    for (const result of [
      { ok: false, code: 'stopped' },
      { ok: true, code: 'not-found' },
      { ok: false, code: 'deleted' },
      { ok: true, code: 'cleanup-failed' },
    ]) {
      expect(paperTaskActionResultSchema.safeParse(result).success).toBe(false)
    }
  })
})
