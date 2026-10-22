import { describe, expect, it, vi } from 'vitest'
import {
  applyReviewEvent,
  buildReviewParts,
  runLocalReview,
  type PaperReviewLocalRunSummary,
  type PaperReviewLocalRunnerDependencies,
} from '../../scripts/paper-review-local/runner'
import type { PaperReviewLocalConfig } from '../../scripts/paper-review-local/config'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import type { PaperReviewTaskResult } from '../../app/utils/paper-review-task-contract'

const CONFIG: PaperReviewLocalConfig = {
  modelId: 'deepseek-r1',
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.example.com/v1',
  protocol: 'openai-completions',
  providerLabel: 'api.example.com',
  pdfPath: 'C:/work/papers/demo.pdf',
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF

function decode(part: PaperReviewMultipartPart): string {
  return new TextDecoder().decode(part.data)
}

/** A valid synthetic task result with two report sections, one pair, and one gap. */
function taskResult(): PaperReviewTaskResult {
  const finding = {
    statement: 'gradient descent converges',
    source: { heading: 'Methods', readerPage: 1, quote: 'we run gradient descent' },
  }
  return {
    status: 'incomplete',
    provider: CONFIG.providerLabel,
    model: CONFIG.modelId,
    source: {
      sourceId: 's1',
      pageCount: 2,
      units: [{ id: 'u-1', spans: [{ readerPage: 1, lineIndex: 0, start: 0, end: 5 }], original: 'source text', heading: 'Methods', kind: 'paragraph' }],
    },
    report: {
      sections: [
        { kind: 'claims', title: 'Claims', findings: [finding] },
        { kind: 'methods', title: 'Methods', findings: [finding] },
      ],
      gaps: [{ section: 'Evidence', reason: 'not evidenced' }],
    },
    translation: {
      pairs: [{ unitId: 'u-1', chinese: '译文' }],
      review: { reviewOf: 'r-1', status: 'passed', checks: [{ unitId: 'u-1', verdict: 'passed' }] },
    },
    gaps: [{ artifact: 'translation', code: 'missing-translation', origin: 'application', unitIds: ['u-1'], readerPages: [1], spans: [{ readerPage: 1, lineIndex: 0, start: 0, end: 5 }], reason: 'translation: missing-translation' }],
  }
}

function startSummary(): PaperReviewLocalRunSummary {
  return { ok: false, stages: [] }
}

describe('paper-review-local runner', () => {
  it('builds the exact multipart parts the pipeline expects', () => {
    // Given: a config and PDF bytes.
    // When: the parts are built.
    const parts = buildReviewParts(CONFIG, PDF_BYTES)

    // Then: the pdf part plus the five text fields are present with correct values.
    expect(parts).toHaveLength(6)
    expect(parts[0].name).toBe('pdf')
    expect(parts[0].filename).toBe('paper.pdf')
    expect(parts[0].type).toBe('application/pdf')
    expect(parts[0].data).toEqual(PDF_BYTES)
    expect(parts[1].name).toBe('providerLabel')
    expect(decode(parts[1])).toBe('api.example.com')
    expect(parts[2].name).toBe('baseUrl')
    expect(decode(parts[2])).toBe('https://api.example.com/v1')
    expect(parts[3].name).toBe('protocol')
    expect(decode(parts[3])).toBe('openai-completions')
    expect(parts[4].name).toBe('model')
    expect(decode(parts[4])).toBe('deepseek-r1')
    expect(parts[5].name).toBe('apiKey')
    expect(decode(parts[5])).toBe('sk-test-key')
  })

  it('accumulates stage names through applyReviewEvent', () => {
    // Given: an empty summary.
    // When: two stage events are applied in order.
    const after = applyReviewEvent(
      applyReviewEvent(startSummary(), { type: 'stage', stage: 'validating' }),
      { type: 'stage', stage: 'extracting' },
    )

    // Then: the stages list is ordered and the summary is not yet ok.
    expect(after.stages).toEqual(['validating', 'extracting'])
    expect(after.ok).toBe(false)
  })

  it('computes status and counts from a task-result event', () => {
    // Given: a mid-run summary before the result event.
    const start: PaperReviewLocalRunSummary = { ok: false, stages: ['analyzing'] }

    // When: the result event is applied.
    const summary = applyReviewEvent(start, { type: 'result', result: taskResult() })

    // Then: the counts and status are set and the summary is ok.
    expect(summary.ok).toBe(true)
    expect(summary.status).toBe('incomplete')
    expect(summary.units).toBe(1)
    expect(summary.pairs).toBe(1)
    expect(summary.reportSections).toBe(2)
    expect(summary.findings).toBe(2)
    expect(summary.gaps).toBe(1)
    expect(summary.reviewStatus).toBe('passed')
  })

  it('records the error code on an error event without surfacing messages', () => {
    // Given: a summary mid-run.
    const start: PaperReviewLocalRunSummary = { ok: false, stages: ['validating', 'extracting'] }

    // When: an error event is applied.
    const summary = applyReviewEvent(start, {
      type: 'error',
      stage: 'verifying',
      code: 'malformed-report',
      message: '模型返回的 JSON 结构不符合审阅报告协议，本次审阅结果不可用。',
    })

    // Then: the run is failed and only the code is retained (never the message).
    expect(summary.ok).toBe(false)
    expect(summary.errorCode).toBe('malformed-report')
    expect(JSON.stringify(summary)).not.toContain('审阅报告')
  })

  it('summarizes a synthetic task result through injected fakes with no paid or file access', async () => {
    // Given: injected fake PDF reader and a synthetic event source.
    const readPdf = async () => PDF_BYTES
    const createEvents = async function* (): AsyncGenerator<PaperReviewStreamEvent> {
      yield { type: 'stage', stage: 'validating' }
      yield { type: 'result', result: taskResult() }
    }

    // When: the runner runs with the fakes.
    const result = await runLocalReview(CONFIG, { readPdf, createEvents })

    // Then: it produces a countable success summary.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.ok).toBe(true)
      expect(result.summary.stages).toEqual(['validating'])
      expect(result.summary.units).toBe(1)
      expect(result.summary.pairs).toBe(1)
      expect(result.summary.reportSections).toBe(2)
      expect(result.summary.findings).toBe(2)
      expect(result.summary.gaps).toBe(1)
      expect(result.summary.reviewStatus).toBe('passed')
    }
  })

  it('fails sanitized when the PDF cannot be read, leaking no path', async () => {
    // Given: a fake PDF reader that throws a path-bearing error.
    const readPdf = async () => {
      throw new Error('ENOENT: no such file C:/secret/path/report.pdf')
    }
    const createEvents = vi.fn<PaperReviewLocalRunnerDependencies['createEvents']>()

    // When: the runner runs.
    const result = await runLocalReview(CONFIG, { readPdf, createEvents })

    // Then: it fails with a sanitized typed code and never calls the event source.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('pdf-unreadable')
    }
    expect(createEvents).not.toHaveBeenCalled()
  })

  it('fails sanitized when the pipeline throws, leaking no SDK detail', async () => {
    // Given: a fake event source that throws an SDK-structured error.
    const readPdf = async () => PDF_BYTES
    const createEvents = async function* (): AsyncGenerator<PaperReviewStreamEvent> {
      yield { type: 'stage', stage: 'validating' }
      throw new Error('DeepSeekHarness MISSING_CREDENTIAL 401 https://api.example.com')
    }

    // When: the runner runs.
    const result = await runLocalReview(CONFIG, { readPdf, createEvents })

    // Then: it fails with the sanitized run-failed code and no detail leaks.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('run-failed')
    }
  })
})