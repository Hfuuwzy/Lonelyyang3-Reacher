import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import {
  runPaperReview,
  RUN_FAILED_MESSAGE,
  type HarnessFactory,
  type PaperReviewModelRequest,
  type PaperReviewRunInput,
} from '../../server/utils/paper-review/harness'
import { createPaperReviewEvents } from '../../server/utils/paper-review/pipeline'
import type { DshBinResolver } from '../../server/utils/paper-review/dsh-bin-resolver'

const KEY = 'sk-paper-review-secret-value'
const KNOWN_INPUT: PaperReviewRunInput = {
  providerLabel: 'Magic Gateway',
  baseUrl: 'https://gateway.example/v1',
  protocol: 'openai-completions',
  model: 'reviewer-max',
  apiKey: KEY,
}

const REQUEST: PaperReviewModelRequest = { purpose: 'report', prompt: 'controlled report prompt' }

const FAKE_LOCAL_BIN = join(tmpdir(), 'paper-review-startup-failure-bin.js')

function okResolver(dshBin: string): DshBinResolver {
  return () => ({ ok: true, dshBin })
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46])

describe('runPaperReview temp-root allocation failure (issue #29)', () => {
  it.each([
    { label: 'Error throw', thrower: () => { throw new Error(`mkdtemp exploded near ${KEY}`) } },
    { label: 'non-Error throw', thrower: () => { throw `mkdtemp exploded near ${KEY}` } },
  ])('maps a $label to a typed key-free run-failed result with no harness or removal', async ({ thrower }) => {
    // Given a throwing temp-root allocator and spies on the factory/remover.
    const record = { launches: 0, removes: 0 }
    const factory: HarnessFactory = (_options: DeepSeekHarnessOptions) => {
      record.launches += 1
      return {
        async run() {
          return { sessionId: 'sess-1', finalResponse: '{ "sections": [] }', events: [] }
        },
        async close() {},
      }
    }

    // When the runner is invoked and the allocator throws.
    const result = await runPaperReview(KNOWN_INPUT, REQUEST, {
      harnessFactory: factory,
      resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
      createTempRoot: () => thrower(),
      removeTempRoot: () => {
        record.removes += 1
      },
    })

    // Then a terminal run-failed failure is returned: no harness was launched,
    // nothing was removed, and neither the key nor the raw allocator detail leaks.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('run-failed')
    expect(result.error.recoverable).toBe(true)
    expect(result.error.message).toBe(RUN_FAILED_MESSAGE)
    expect(result.error.message).not.toContain(KEY)
    expect(result.error.message).not.toContain('mkdtemp exploded')
    expect(record.launches).toBe(0)
    expect(record.removes).toBe(0)
  })

  it('localizes every run failure without a generator rejection and ends in an incomplete result', async () => {
    // Given a valid multipart body and an extraction fake, plus the real runner
    // whose temp-root allocator throws.
    const parts: PaperReviewMultipartPart[] = [
      { name: 'pdf', filename: 'paper.pdf', type: 'application/pdf', data: PDF_BYTES },
      { name: 'providerLabel', data: new TextEncoder().encode(KNOWN_INPUT.providerLabel) },
      { name: 'baseUrl', data: new TextEncoder().encode(KNOWN_INPUT.baseUrl) },
      { name: 'protocol', data: new TextEncoder().encode(KNOWN_INPUT.protocol) },
      { name: 'model', data: new TextEncoder().encode(KNOWN_INPUT.model) },
      { name: 'apiKey', data: new TextEncoder().encode(KNOWN_INPUT.apiKey) },
    ]
    const page: ExtractedPaperPage = {
      readerPage: 1,
      lines: [{ text: 'Introduction', isHeading: true }],
      headings: ['Introduction'],
      text: 'Introduction',
    }
    const events: PaperReviewStreamEvent[] = []
    let rejection: unknown

    // When the pipeline runs to the first model request whose real runner cannot
    // allocate a temp home.
    const stream = createPaperReviewEvents(parts, {
      extractPaperPages: async () => ({ success: true, pageCount: 1, pages: [page] }),
      runPaperReview: (input, request, _deps, options) =>
        runPaperReview(input, request, { createTempRoot: () => { throw new Error(`mkdtemp exploded near ${KEY}`) } }, options),
    })
    try {
      for await (const event of stream) {
        events.push(event)
      }
    } catch (error) {
      rejection = error
    }

    // Then the generator never rejects: every purpose run-failure localizes (only
    // cancellation/cleanup are fatal), the pipeline continues through translation,
    // and the stream ends in one terminal incomplete task result — no error events.
    expect(rejection).toBeUndefined()
    const stages = events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting', 'inventorying', 'analyzing', 'translating'])
    const errors = events.filter((event): event is Extract<PaperReviewStreamEvent, { type: 'error' }> => event.type === 'error')
    expect(errors).toHaveLength(0)
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('result')
    if (terminal?.type === 'result') {
      expect(terminal.result.status).toBe('incomplete')
    }
  })
})
