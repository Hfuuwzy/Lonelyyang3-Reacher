import { describe, expect, it } from 'vitest'
import { consumePaperReviewStream } from '../../app/utils/paper-review-stream'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'

// Fixed literal event data. Expectations are hand-written literals, never
// derived from the implementation's own constants or schema.
function sse(json: string): string {
  return `data: ${json}\n\n`
}

async function* asyncChunks(chunks: readonly string[]): AsyncGenerator<string> {
  yield* chunks
}

const REPORT_EVENT =
  '{"type":"report","report":{"status":"incomplete","provider":"goaichat","model":"glm-5.2",'
  + '"sections":[{"kind":"claims","title":"核心论断","findings":[{"statement":"论点甲",'
  + '"source":{"heading":"引言","readerPage":3,"printedPage":"12","quote":"原文引文甲"}}]}],'
  + '"gaps":[{"section":"实验","reason":"数据缺失"}],"missingScope":["full-translation"]}}'

const EXPECTED_REPORT = {
  status: 'incomplete',
  provider: 'goaichat',
  model: 'glm-5.2',
  sections: [
    {
      kind: 'claims',
      title: '核心论断',
      findings: [
        {
          statement: '论点甲',
          source: { heading: '引言', readerPage: 3, printedPage: '12', quote: '原文引文甲' },
        },
      ],
    },
  ],
  gaps: [{ section: '实验', reason: '数据缺失' }],
  missingScope: ['full-translation'],
} as const

function countingSource(chunks: readonly string[]) {
  let iteratorStarts = 0
  let pulls = 0
  const source: AsyncIterable<string> = {
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      iteratorStarts += 1
      for (const chunk of chunks) {
        pulls += 1
        yield chunk
      }
    },
  }
  return {
    source,
    iteratorStarts: (): number => iteratorStarts,
    pulls: (): number => pulls,
  }
}

describe('paper-review stream consumer', () => {
  it('parses blank-line-delimited events split across arbitrary chunk boundaries', async () => {
    // Given: SSE text split mid-JSON, with CRLF delimiters and a final
    // unterminated event at EOF.
    const chunks = [
      'data: {"type":"stage","stage":"valid',
      'ating"}\n\ndata: {"type":"stage","stage":"e',
      'xtracting"}\n\ndata: {"type":"stage","stage":"analy',
      'zing"}\n\r\ndata: ',
      REPORT_EVENT,
    ]

    // When: the consumer reads the split chunks.
    const received: PaperReviewStreamEvent[] = []
    const outcome = await consumePaperReviewStream(asyncChunks(chunks), {
      onEvent: (event) => {
        received.push(event)
      },
    })

    // Then: every stage event is recovered in order and the run ends in report.
    const stages = received.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting', 'analyzing'])
    expect(outcome.kind).toBe('report')
    if (outcome.kind !== 'report') {
      return
    }
    expect(outcome.report).toEqual(EXPECTED_REPORT)
  })

  it('emits the four known stages in order and ends with the report event', async () => {
    // Given: one event per known stage followed by a report.
    const stream = [
      sse('{"type":"stage","stage":"validating"}'),
      sse('{"type":"stage","stage":"extracting"}'),
      sse('{"type":"stage","stage":"analyzing"}'),
      sse('{"type":"stage","stage":"verifying"}'),
      sse(REPORT_EVENT),
    ].join('')

    // When: the consumer processes the stream.
    const stages: string[] = []
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {
      onEvent: (event) => {
        if (event.type === 'stage') {
          stages.push(event.stage)
        }
      },
    })

    // Then: the stages arrive in protocol order and the report is terminal.
    expect(stages).toEqual(['validating', 'extracting', 'analyzing', 'verifying'])
    expect(outcome).toEqual({ kind: 'report', report: EXPECTED_REPORT })
  })

  it('propagates a server error event with its stage, code, and message', async () => {
    // Given: a validating stage followed by an error event at the extracting stage.
    const stream = sse('{"type":"stage","stage":"validating"}')
      + sse('{"type":"error","stage":"extracting","code":"extract-failed","message":"无法读取 PDF 正文"}')

    // When: the consumer processes the stream.
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {})

    // Then: the run ends in error with the server event preserved verbatim.
    expect(outcome).toEqual({
      kind: 'error',
      error: {
        type: 'error',
        stage: 'extracting',
        code: 'extract-failed',
        message: '无法读取 PDF 正文',
      },
    })
  })

  it('ends in a local actionable error when an event contains malformed JSON', async () => {
    // Given: a truncated JSON payload inside a data line.
    const stream = 'data: {"type":"stage","stage":"validati'

    // When: the consumer processes the stream.
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {})

    // Then: a malformed-json stream error is returned with a non-empty message.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.type).toBe('stream-error')
    if (outcome.error.type !== 'stream-error') {
      return
    }
    expect(outcome.error.code).toBe('malformed-json')
    expect(typeof outcome.error.message).toBe('string')
    expect(outcome.error.message.length).toBeGreaterThan(0)
  })

  it('ends in a local actionable error when an event does not match the protocol', async () => {
    // Given: a valid-JSON event with an unknown type.
    const stream = sse('{"type":"wonderful","payload":123}')

    // When: the consumer processes the stream.
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {})

    // Then: an unknown-event stream error is returned.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.type).toBe('stream-error')
    if (outcome.error.type !== 'stream-error') {
      return
    }
    expect(outcome.error.code).toBe('unknown-event')
    expect(outcome.error.message.length).toBeGreaterThan(0)
  })

  it('does not echo malformed event payloads into the user-visible error', async () => {
    // Given malformed JSON carrying a credential-like marker.
    const secret = 'sk-do-not-echo-this-value'
    const stream = `data: {"secret":"${secret}"\n\n`

    // When the consumer rejects the event.
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {})

    // Then the error is actionable but never repeats untrusted response data.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.message).not.toContain(secret)
  })

  it('rejects report locations that use zero-based reader pages', async () => {
    // Given a report event with readerPage zero.
    const zeroBasedReport = '{"type":"report","report":{"status":"incomplete","provider":"goaichat","model":"glm-5.2","sections":[{"kind":"claims","title":"核心论断","findings":[{"statement":"论点甲","source":{"heading":"引言","readerPage":0,"quote":"原文引文甲"}}]}],"gaps":[],"missingScope":["full-translation"]}}'

    // When the consumer validates the event.
    const outcome = await consumePaperReviewStream(asyncChunks([sse(zeroBasedReport)]), {})

    // Then the zero-based location is rejected as a protocol error.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.type).toBe('stream-error')
    if (outcome.error.type !== 'stream-error') {
      return
    }
    expect(outcome.error.code).toBe('unknown-event')
  })

  it('ends in a local actionable error when the stream ends without a terminal event', async () => {
    // Given: only stage events, no report or error.
    const stream = sse('{"type":"stage","stage":"validating"}')
      + sse('{"type":"stage","stage":"extracting"}')

    // When: the consumer reaches end-of-stream.
    const outcome = await consumePaperReviewStream(asyncChunks([stream]), {})

    // Then: a missing-terminal-event stream error is returned.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.type).toBe('stream-error')
    if (outcome.error.type !== 'stream-error') {
      return
    }
    expect(outcome.error.code).toBe('missing-terminal-event')
    expect(outcome.error.message.length).toBeGreaterThan(0)
  })

  it('consumes the provided stream exactly once and never issues a second request', async () => {
    // Given: a counting source and a stream that ends in a report.
    const chunks = [sse('{"type":"stage","stage":"validating"}'), sse(REPORT_EVENT)]
    const { source, iteratorStarts, pulls } = countingSource(chunks)

    // When: the consumer runs to completion.
    const outcome = await consumePaperReviewStream(source, {})

    // Then: the single provided stream is pulled exactly once to exhaustion —
    // the consumer never re-reads it and never issues its own request.
    expect(iteratorStarts()).toBe(1)
    expect(pulls()).toBe(chunks.length)
    expect(outcome.kind).toBe('report')
  })
})
