import { describe, expect, it } from 'vitest'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import {
  createPaperReviewEvents,
  type PaperReviewLifecycleOptions,
  type PaperReviewPipelineDependencies,
} from '../../server/utils/paper-review/pipeline'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import type { PaperReviewHarnessErrorCode, PaperReviewHarnessResult } from '../../server/utils/paper-review/harness'
import type { PaperReviewReportResult } from '../../server/utils/paper-review/report'

function textPart(name: string, value: string): PaperReviewMultipartPart {
  return { name, data: new TextEncoder().encode(value) }
}

/** A minimal valid multipart upload: one PDF plus the five required fields. */
const PARTS: readonly PaperReviewMultipartPart[] = [
  { name: 'pdf', filename: 'paper.pdf', type: 'application/pdf', data: new TextEncoder().encode('%PDF-1.7 fake') },
  textPart('providerLabel', 'Magic Gateway'),
  textPart('baseUrl', 'https://gateway.example/v1'),
  textPart('protocol', 'openai-completions'),
  textPart('model', 'reviewer-max'),
  textPart('apiKey', 'sk-paper-review-secret-value'),
]

async function collect(deps: PaperReviewPipelineDependencies): Promise<PaperReviewStreamEvent[]> {
  const events: PaperReviewStreamEvent[] = []
  for await (const event of createPaperReviewEvents(PARTS, deps)) {
    events.push(event)
  }
  return events
}

function successReport(): PaperReviewReportResult {
  return {
    success: true,
    report: {
      status: 'incomplete',
      provider: 'Magic Gateway',
      model: 'reviewer-max',
      sections: [],
      gaps: [],
      missingScope: ['full-translation'],
    },
  }
}

/** A runner whose report-purpose call fails; every other purpose succeeds. */
function reportFailingRun(error: { readonly code: PaperReviewHarnessErrorCode; readonly message: string }) {
  return async (_input: unknown, request: { readonly purpose: string }): Promise<PaperReviewHarnessResult> =>
    request.purpose === 'report'
      ? { success: false, error: { ...error, recoverable: true } }
      : { success: true, finalResponse: '{}' }
}

describe('paper-review pipeline analyzing failure', () => {
  it('localizes a report run failure and continues to translation and review', async () => {
    // Given a successful extraction/inventory and a run that fails on the report purpose.
    let verifyCalls = 0
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({ success: true, pageCount: 0, pages: [] }),
      runPaperReview: reportFailingRun({ code: 'run-failed', message: 'The model review run failed; please try again later.' }),
      verifyPaperReview: () => {
        verifyCalls += 1
        return successReport()
      },
    }

    // When the pipeline runs; the report batch fails but is not fatal.
    const events = await collect(deps)

    // Then the report failure localizes (only cancel/cleanup are fatal), the
    // pipeline still reaches translation and review, and the stream ends in a
    // terminal incomplete task result — never a bare analyzing error.
    const stages = events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting', 'inventorying', 'analyzing', 'translating', 'verifying'])
    expect(verifyCalls).toBe(0)
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('result')
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function collectWithOptions(
  deps: PaperReviewPipelineDependencies,
  options: PaperReviewLifecycleOptions,
): Promise<PaperReviewStreamEvent[]> {
  const events: PaperReviewStreamEvent[] = []
  for await (const event of createPaperReviewEvents(PARTS, deps, options)) {
    events.push(event)
  }
  return events
}

describe('paper-review pipeline cancellation', () => {
  it('emits a cancelled analyzing error and never emits a result when the signal aborts mid-run', async () => {
    // Given a controllable runner gated behind a promise and a live abort signal.
    const controller = new AbortController()
    const runPending = deferred()
    const runGate = deferred()
    let verifyCalls = 0
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({ success: true, pageCount: 0, pages: [] }),
      runPaperReview: (_input, request) => {
        if (request.purpose === 'report') {
          runPending.resolve()
          return runGate.promise.then(() => ({ success: true, finalResponse: '{}' }))
        }
        return Promise.resolve({ success: true, finalResponse: '{}' })
      },
      verifyPaperReview: () => {
        verifyCalls += 1
        return successReport()
      },
    }

    // When we consume the stream the report run starts, then the client disconnects.
    const events: PaperReviewStreamEvent[] = []
    const iterator = createPaperReviewEvents(PARTS, deps, { signal: controller.signal })[Symbol.asyncIterator]()
    const consume = (async () => {
      for (;;) {
        const next = await iterator.next()
        if (next.done) {
          return
        }
        events.push(next.value)
      }
    })()
    await runPending.promise
    controller.abort()
    runGate.resolve()

    // Then the stream ends in a single cancelled analyzing error and never
    // reaches verification or the result.
    await consume
    const stages = events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting', 'inventorying', 'analyzing'])
    expect(verifyCalls).toBe(0)
    expect(events.filter((event) => event.type === 'result')).toHaveLength(0)
    expect(events[events.length - 1]).toEqual({
      type: 'error',
      stage: 'analyzing',
      code: 'cancelled',
      message: expect.any(String),
    })
  })

  it('emits a cancelled extracting error when the signal aborts during extraction', async () => {
    // Given a controllable extractor gated behind a promise.
    const controller = new AbortController()
    const extractPending = deferred()
    const extractGate = deferred()
    let runCalls = 0
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: () => {
        extractPending.resolve()
        return extractGate.promise.then(() => ({ success: true, pageCount: 0, pages: [] }))
      },
      runPaperReview: () => {
        runCalls += 1
        return Promise.resolve({ success: true, finalResponse: '{}' })
      },
      verifyPaperReview: () => successReport(),
    }

    const events: PaperReviewStreamEvent[] = []
    const iterator = createPaperReviewEvents(PARTS, deps, { signal: controller.signal })[Symbol.asyncIterator]()
    const consume = (async () => {
      for (;;) {
        const next = await iterator.next()
        if (next.done) {
          return
        }
        events.push(next.value)
      }
    })()
    await extractPending.promise
    controller.abort()
    extractGate.resolve()

    await consume
    const stages = events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting'])
    expect(runCalls).toBe(0)
    expect(events[events.length - 1]).toEqual({
      type: 'error',
      stage: 'extracting',
      code: 'cancelled',
      message: expect.any(String),
    })
  })

  it('emits a cancelled validating error without running any stage when the signal is already aborted', async () => {
    // Given a signal that is already aborted before the pipeline starts.
    const controller = new AbortController()
    controller.abort()
    let extractCalls = 0
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => {
        extractCalls += 1
        return { success: true, pageCount: 0, pages: [] }
      },
      runPaperReview: async () => ({ success: true, finalResponse: '{}' }),
      verifyPaperReview: () => successReport(),
    }

    // When the pipeline runs against the already-aborted signal.
    const events = await collectWithOptions(deps, { signal: controller.signal })

    // Then only a single validating-cancelled error is emitted and nothing runs.
    expect(events).toEqual([{ type: 'error', stage: 'validating', code: 'cancelled', message: expect.any(String) }])
    expect(extractCalls).toBe(0)
  })

  it('propagates the lifecycle signal to the extractor and the runner options', async () => {
    // Given a signal and fakes that record what they receive.
    const controller = new AbortController()
    let seenExtractSignal: AbortSignal | undefined
    let seenRunOptions: { signal?: AbortSignal } | undefined
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: (_bytes, signal) => {
        seenExtractSignal = signal
        return Promise.resolve({ success: true, pageCount: 0, pages: [] })
      },
      runPaperReview: (_input, _request, _runnerDeps, options) => {
        seenRunOptions = options
        return Promise.resolve({ success: true, finalResponse: '{}' })
      },
      verifyPaperReview: () => successReport(),
    }

    // When the pipeline completes normally with the signal provided.
    await collectWithOptions(deps, { signal: controller.signal })

    // Then the same signal reached the extractor and the runner's options.
    expect(seenExtractSignal).toBe(controller.signal)
    expect(seenRunOptions?.signal).toBe(controller.signal)
  })

  it('does not misclassify a normal completion as cancelled when a signal is provided but never aborts', async () => {
    // Given a provided signal that is never aborted and fakes that succeed.
    const controller = new AbortController()
    const deps: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({ success: true, pageCount: 0, pages: [] }),
      runPaperReview: async () => ({ success: true, finalResponse: '{}' }),
      verifyPaperReview: () => successReport(),
    }

    // When the pipeline completes normally with that un-aborted signal.
    const events = await collectWithOptions(deps, { signal: controller.signal })

    // Then it still ends in the result and never emits a cancelled error.
    const terminal = events[events.length - 1]
    expect(terminal.type).toBe('result')
    expect(events.some((event) => event.type === 'error' && event.code === 'cancelled')).toBe(false)
  })
})