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

const RESULT_EVENT =
  '{"type":"result","result":{"status":"incomplete","provider":"goaichat","model":"glm-5.2",'
  + '"source":{"sourceId":"s1","pageCount":1,"units":[{"id":"u-1","spans":[{"readerPage":1,"lineIndex":0,"start":0,"end":5}],"original":"abc","heading":"","kind":"paragraph"}]},'
  + '"report":{"sections":[{"kind":"claims","title":"核心论断","findings":[{"statement":"论点甲",'
  + '"source":{"heading":"引言","readerPage":1,"quote":"原文引文甲"}}]}],"gaps":[]},'
  + '"translation":{"pairs":[{"unitId":"u-1","chinese":"译文"}],"review":{"reviewOf":"r1","status":"passed","checks":[{"unitId":"u-1","verdict":"passed"}]}},'
  + '"gaps":[]}}'

const EXPECTED_RESULT = {
  status: 'incomplete',
  provider: 'goaichat',
  model: 'glm-5.2',
  source: {
    sourceId: 's1',
    pageCount: 1,
    units: [{ id: 'u-1', spans: [{ readerPage: 1, lineIndex: 0, start: 0, end: 5 }], original: 'abc', heading: '', kind: 'paragraph' }],
  },
  report: {
    sections: [
      {
        kind: 'claims',
        title: '核心论断',
        findings: [{ statement: '论点甲', source: { heading: '引言', readerPage: 1, quote: '原文引文甲' } }],
      },
    ],
    gaps: [],
  },
  translation: {
    pairs: [{ unitId: 'u-1', chinese: '译文' }],
    review: { reviewOf: 'r1', status: 'passed', checks: [{ unitId: 'u-1', verdict: 'passed' }] },
  },
  gaps: [],
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
      'xtracting"}\n\ndata: {"type":"stage","stage":"inventor',
      'ying"}\n\r\ndata: ',
      RESULT_EVENT,
    ]

    // When: the consumer reads the split chunks.
    const received: PaperReviewStreamEvent[] = []
    const outcome = await consumePaperReviewStream(asyncChunks(chunks), {
      onEvent: (event) => {
        received.push(event)
      },
    })

    // Then: every stage event is recovered in order and the run ends in result.
    const stages = received.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
    expect(stages).toEqual(['validating', 'extracting', 'inventorying'])
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') {
      return
    }
    expect(outcome.result).toEqual(EXPECTED_RESULT)
  })

  it('emits the six known stages in order and ends with the result event', async () => {
    // Given: one event per known stage followed by a result.
    const stream = [
      sse('{"type":"stage","stage":"validating"}'),
      sse('{"type":"stage","stage":"extracting"}'),
      sse('{"type":"stage","stage":"inventorying"}'),
      sse('{"type":"stage","stage":"analyzing"}'),
      sse('{"type":"stage","stage":"translating"}'),
      sse('{"type":"stage","stage":"verifying"}'),
      sse(RESULT_EVENT),
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

    // Then: the stages arrive in protocol order and the result is terminal.
    expect(stages).toEqual(['validating', 'extracting', 'inventorying', 'analyzing', 'translating', 'verifying'])
    expect(outcome).toEqual({ kind: 'result', result: EXPECTED_RESULT })
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

  it('rejects task results whose source spans use zero-based reader pages', async () => {
    // Given a result event with a readerPage of zero in a source span.
    const zeroBasedResult = '{"type":"result","result":{"status":"incomplete","provider":"goaichat","model":"glm-5.2","source":{"sourceId":"s1","pageCount":1,"units":[{"id":"u-1","spans":[{"readerPage":0,"lineIndex":0,"start":0,"end":5}],"original":"abc","heading":"","kind":"paragraph"}]},"report":{"sections":[],"gaps":[]},"translation":{"pairs":[],"review":{"reviewOf":"r","status":"passed","checks":[]}},"gaps":[]}}'

    // When the consumer validates the event.
    const outcome = await consumePaperReviewStream(asyncChunks([sse(zeroBasedResult)]), {})

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

  it('rejects empty source ranges in a task result', async () => {
    // Given a result event whose source span has an empty UTF-16 range.
    const emptyRange = RESULT_EVENT.replace('"start":0,"end":5', '"start":5,"end":5')

    // When the consumer validates the event.
    const outcome = await consumePaperReviewStream(asyncChunks([sse(emptyRange)]), {})

    // Then the malformed span is rejected as a protocol error.
    expect(outcome).toMatchObject({ kind: 'error', error: { type: 'stream-error', code: 'unknown-event' } })
  })

  it('rejects source spans beyond the declared PDF page count', async () => {
    // Given a result event with an otherwise valid span on a nonexistent page.
    const outOfRange = RESULT_EVENT.replace('"readerPage":1,"lineIndex":0', '"readerPage":2,"lineIndex":0')

    // When the consumer validates the event.
    const outcome = await consumePaperReviewStream(asyncChunks([sse(outOfRange)]), {})

    // Then the out-of-range span is rejected as a protocol error.
    expect(outcome).toMatchObject({ kind: 'error', error: { type: 'stream-error', code: 'unknown-event' } })
  })

  it('rejects a result whose report finding cites a page beyond the source page count', async () => {
    // Given a result event whose report finding readerPage exceeds source.pageCount.
    const outOfRangeCitation = RESULT_EVENT.replace('"readerPage":1,"quote":"原文引文甲"', '"readerPage":2,"quote":"原文引文甲"')

    // When the consumer validates the event.
    const outcome = await consumePaperReviewStream(asyncChunks([sse(outOfRangeCitation)]), {})

    // Then the out-of-range citation is rejected as a protocol error.
    expect(outcome).toMatchObject({ kind: 'error', error: { type: 'stream-error', code: 'unknown-event' } })
  })

  it('ends in a local actionable error when the stream ends without a terminal event', async () => {
    // Given: only stage events, no result or error.
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
    // Given: a counting source and a stream that ends in a result.
    const chunks = [sse('{"type":"stage","stage":"validating"}'), sse(RESULT_EVENT)]
    const { source, iteratorStarts, pulls } = countingSource(chunks)

    // When: the consumer runs to completion.
    const outcome = await consumePaperReviewStream(source, {})

    // Then: the single provided stream is pulled exactly once to exhaustion —
    // the consumer never re-reads it and never issues its own request.
    expect(iteratorStarts()).toBe(1)
    expect(pulls()).toBe(chunks.length)
    expect(outcome.kind).toBe('result')
  })
})
