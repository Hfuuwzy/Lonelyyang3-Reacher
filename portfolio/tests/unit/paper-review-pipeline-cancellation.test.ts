import { describe, expect, it } from 'vitest'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import {
  createPaperReviewEvents,
  type PaperReviewPipelineDependencies,
} from '../../server/utils/paper-review/pipeline'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import type { PaperReviewHarnessResult } from '../../server/utils/paper-review/harness'
import { HARNESS_MESSAGES, runModelRequest } from '../../server/paper-review-internal/pipeline-outcomes'
import type { PaperReviewRunInput } from '../../server/utils/paper-review/harness'

function field(name: string, value: string): PaperReviewMultipartPart {
  return { name, data: new TextEncoder().encode(value) }
}

const PARTS: readonly PaperReviewMultipartPart[] = [
  { name: 'pdf', filename: 'paper.pdf', type: 'application/pdf', data: new TextEncoder().encode('%PDF-1.7 test') },
  field('providerLabel', 'Local provider'),
  field('baseUrl', 'https://gateway.example/v1'),
  field('protocol', 'openai-completions'),
  field('model', 'reviewer-test'),
  field('apiKey', 'sk-paper-review-test'),
]

describe('createPaperReviewEvents cancellation', () => {
  it('ends the active stage with cancelled and skips verification after abort', async () => {
    const controller = new AbortController()
    let startRun!: () => void
    const runStarted = new Promise<void>((resolve) => { startRun = resolve })
    let verifyCalls = 0
    const dependencies: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({ success: true, pageCount: 0, pages: [] }),
      runPaperReview: (_input, _pages, _runnerDependencies, options) => new Promise<PaperReviewHarnessResult>((resolve) => {
        startRun()
        options?.signal?.addEventListener('abort', () => {
          resolve({ success: false, error: { code: 'cancelled', message: 'cancelled', recoverable: false } })
        }, { once: true })
      }),
      verifyPaperReview: () => {
        verifyCalls += 1
        return { success: false, error: { code: 'malformed-report', message: 'invalid' } }
      },
    }

    const events: PaperReviewStreamEvent[] = []
    const pending = (async () => {
      for await (const event of createPaperReviewEvents(PARTS, dependencies, { signal: controller.signal })) {
        events.push(event)
      }
    })()
    await runStarted
    controller.abort()
    await pending

    const terminal = events.at(-1)
    const activeStage = events.filter((event) => event.type === 'stage').at(-1)
    expect(terminal).toEqual({
      type: 'error',
      stage: activeStage?.type === 'stage' ? activeStage.stage : undefined,
      code: 'cancelled',
      message: expect.any(String),
    })
    expect(verifyCalls).toBe(0)
    expect(events.some((event) => event.type === 'report')).toBe(false)
  })

  it('emits a single cleanup-failed error at the active stage with no later stage after abort + cleanup failure', async () => {
    const controller = new AbortController()
    let resolveRun!: (result: PaperReviewHarnessResult) => void
    let runEntered!: () => void
    const runEnteredPromise = new Promise<void>((resolve) => { runEntered = resolve })
    const runPromise = new Promise<PaperReviewHarnessResult>((resolve) => { resolveRun = resolve })
    const dependencies: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({
        success: true,
        pageCount: 1,
        pages: [{ readerPage: 1, lines: [{ text: 'Introduction', isHeading: true }], headings: ['Introduction'], text: 'Introduction' }],
      }),
      runPaperReview: async () => {
        runEntered()
        return runPromise
      },
      verifyPaperReview: () => ({ success: false, error: { code: 'malformed-report', message: 'invalid' } }),
    }

    const events: PaperReviewStreamEvent[] = []
    const pending = (async () => {
      for await (const event of createPaperReviewEvents(PARTS, dependencies, { signal: controller.signal })) {
        events.push(event)
      }
    })()
    await runEnteredPromise
    controller.abort()
    resolveRun({ success: false, error: { code: 'cleanup-failed', message: 'boom', recoverable: true } })
    await pending

    expect(events.at(-1)).toEqual({
      type: 'error',
      stage: 'inventorying',
      code: 'cleanup-failed',
      message: HARNESS_MESSAGES['cleanup-failed'],
    })
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.some((event) => event.type === 'stage' && event.stage === 'analyzing')).toBe(false)
    expect(events.some((event) => event.type === 'report')).toBe(false)
  })
})

const RUN_INPUT: PaperReviewRunInput = {
  providerLabel: 'Local provider',
  baseUrl: 'https://gateway.example/v1',
  protocol: 'openai-completions',
  model: 'reviewer-test',
  apiKey: 'sk-paper-review-test',
}

const PURPOSE_STAGES = [
  { stage: 'inventorying', purpose: 'inventory' },
  { stage: 'analyzing', purpose: 'report' },
  { stage: 'translating', purpose: 'translation' },
  { stage: 'verifying', purpose: 'source-review' },
] as const

describe('runModelRequest cleanup-failed precedence', () => {
  it.each(PURPOSE_STAGES)('preserves cleanup-failed over cancellation at $stage', ({ stage, purpose }) => {
    const controller = new AbortController()
    let resolveRun!: (result: PaperReviewHarnessResult) => void
    const runPromise = new Promise<PaperReviewHarnessResult>((resolve) => { resolveRun = resolve })
    const resultPromise = runModelRequest(
      async () => runPromise,
      { input: RUN_INPUT, request: { purpose, prompt: 'prompt' }, signal: controller.signal, stage },
    )
    controller.abort()
    resolveRun({ success: false, error: { code: 'cleanup-failed', message: 'boom', recoverable: true } })

    return resultPromise.then((result) => {
      expect(result.kind).toBe('error')
      if (result.kind === 'error') {
        expect(result.error.code).toBe('cleanup-failed')
        expect(result.error.stage).toBe(stage)
        expect(result.error.message).toBe(HARNESS_MESSAGES['cleanup-failed'])
      }
    })
  })

  it('returns cancelled after abort with a late successful run', async () => {
    const controller = new AbortController()
    let resolveRun!: (result: PaperReviewHarnessResult) => void
    const runPromise = new Promise<PaperReviewHarnessResult>((resolve) => { resolveRun = resolve })
    const resultPromise = runModelRequest(
      async () => runPromise,
      { input: RUN_INPUT, request: { purpose: 'inventory', prompt: 'prompt' }, signal: controller.signal, stage: 'inventorying' },
    )
    controller.abort()
    resolveRun({ success: true, finalResponse: 'ok' })

    const result = await resultPromise
    expect(result).toEqual({ kind: 'error', error: { type: 'error', stage: 'inventorying', code: 'cancelled', message: expect.any(String) } })
  })

  it('returns cancelled after abort with a late ordinary run-failed result', async () => {
    const controller = new AbortController()
    let resolveRun!: (result: PaperReviewHarnessResult) => void
    const runPromise = new Promise<PaperReviewHarnessResult>((resolve) => { resolveRun = resolve })
    const resultPromise = runModelRequest(
      async () => runPromise,
      { input: RUN_INPUT, request: { purpose: 'inventory', prompt: 'prompt' }, signal: controller.signal, stage: 'inventorying' },
    )
    controller.abort()
    resolveRun({ success: false, error: { code: 'run-failed', message: 'boom', recoverable: true } })

    const result = await resultPromise
    expect(result).toEqual({ kind: 'error', error: { type: 'error', stage: 'inventorying', code: 'cancelled', message: expect.any(String) } })
  })

  it('returns cleanup-failed without cancellation', async () => {
    const result = await runModelRequest(
      async () => ({ success: false, error: { code: 'cleanup-failed', message: 'boom', recoverable: true } }),
      { input: RUN_INPUT, request: { purpose: 'inventory', prompt: 'prompt' }, signal: undefined, stage: 'inventorying' },
    )
    expect(result).toEqual({
      kind: 'error',
      error: { type: 'error', stage: 'inventorying', code: 'cleanup-failed', message: HARNESS_MESSAGES['cleanup-failed'] },
    })
  })
})
