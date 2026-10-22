import { describe, expect, it } from 'vitest'
import { consumePaperTaskStream } from '../../app/utils/paper-task-stream'
import type { PaperTaskStreamErrorCode } from '../../app/utils/paper-task-stream'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'

function sse(json: string): string {
  return `data: ${json}\n\n`
}

function acceptedJson(selection: 'translation' | 'deep-reading' | 'both' = 'both'): string {
  return JSON.stringify({ type: 'accepted', taskId: TASK_ID, selection })
}

function terminalJson(
  outcome: 'succeeded' | 'cancelled' = 'succeeded',
  branches: { translation: string; 'deep-reading': string } = {
    translation: 'sample-ready',
    'deep-reading': 'sample-ready',
  },
): string {
  return JSON.stringify({ type: 'terminal', taskId: TASK_ID, outcome, branches, cleanup: 'clean' })
}

async function* asyncChunks(chunks: readonly string[]): AsyncGenerator<string> {
  yield* chunks
}

async function outcomeOf(chunks: readonly string[], selection: 'translation' | 'deep-reading' | 'both' = 'both') {
  return consumePaperTaskStream(asyncChunks(chunks), { selection })
}

describe('paper-task stream consumer', () => {
  it('recovers events split across arbitrary chunk boundaries and stops at the terminal', async () => {
    // Given: SSE text split mid-JSON with CRLF delimiters and a final
    // unterminated event at EOF.
    const chunks = [
      'data: {"type":"accepted","taskId":"123e4567-e89b-12d3',
      '-a456-426614174000","selection":"both"}\n\ndata: {"type":"progress",',
      '"taskId":"123e4567-e89b-12d3-a456-426614174000","stage":"preparing","branch":null,"completed":0,"total":1}\n\ndata: {"type":"preview","taskId":"123e4567-e89b-12d3-a456-426614174000","branch":"translation","designation":"sample","paragraphs":["样例译文。"]}\n\nd',
      'ata: ',
      '{"type":"terminal","taskId":"123e4567-e89b-12d3-a456-426614174000","outcome":"succeeded","branches":{"translation":"sample-ready","deep-reading":"sample-ready"},"cleanup":"clean"}',
    ]

    // When: the consumer reads the split chunks.
    const received: PaperTaskEvent[] = []
    const outcome = await consumePaperTaskStream(asyncChunks(chunks), {
      selection: 'both',
      onEvent: (event) => {
        received.push(event)
      },
    })

    // Then: every event is recovered in order and the run ends at the terminal.
    expect(received.map((event) => event.type)).toEqual(['accepted', 'progress', 'preview', 'terminal'])
    expect(outcome.kind).toBe('terminal')
  })

  it('streams accepted, progress, preview for each branch, then a succeeded terminal', async () => {
    // Given: a complete both-selection stream.
    const stream = [
      sse(acceptedJson('both')),
      sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"preparing","branch":null,"completed":1,"total":1}'),
      sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"generating","branch":"translation","completed":0,"total":2}'),
      sse('{"type":"preview","taskId":"' + TASK_ID + '","branch":"translation","designation":"sample","paragraphs":["样例译文。"]}'),
      sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"generating","branch":"deep-reading","completed":2,"total":2}'),
      sse('{"type":"preview","taskId":"' + TASK_ID + '","branch":"deep-reading","designation":"sample","paragraphs":["样例报告。"]}'),
      sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"cleaning","branch":null,"completed":1,"total":1}'),
      sse(terminalJson()),
    ].join('')

    // When: the consumer processes the stream.
    const eventTypes: string[] = []
    const previews: string[] = []
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), {
      selection: 'both',
      onEvent: (event) => {
        eventTypes.push(event.type)
        if (event.type === 'preview') {
          previews.push(event.branch)
        }
      },
    })

    // Then: events arrive in protocol order and the terminal is preserved.
    expect(eventTypes).toEqual(['accepted', 'progress', 'progress', 'preview', 'progress', 'preview', 'progress', 'terminal'])
    expect(previews).toEqual(['translation', 'deep-reading'])
    expect(outcome.kind).toBe('terminal')
    if (outcome.kind !== 'terminal') {
      return
    }
    expect(outcome.terminal).toMatchObject({ type: 'terminal', outcome: 'succeeded', cleanup: 'clean' })
  })

  it('keeps a preview event when a sibling has not produced one yet', async () => {
    // Given: a translation preview before a terminal where deep-reading failed.
    const stream = sse(acceptedJson('both'))
      + sse('{"type":"preview","taskId":"' + TASK_ID + '","branch":"translation","designation":"sample","paragraphs":["样例译文。"]}')
      + sse('{"type":"terminal","taskId":"' + TASK_ID + '","outcome":"failed","branches":{"translation":"sample-ready","deep-reading":"failed"},"cleanup":"clean"}')

    // When: the consumer processes the stream.
    const previews: PaperTaskEvent[] = []
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), {
      selection: 'both',
      onEvent: (event) => {
        if (event.type === 'preview') {
          previews.push(event)
        }
      },
    })

    // Then: the successful sibling's preview is retained alongside the failure.
    expect(previews).toHaveLength(1)
    expect(previews[0]?.type).toBe('preview')
    expect(outcome.kind).toBe('terminal')
  })

  it('drops comment and keep-alive-only SSE frames', async () => {
    // Given: comment lines and a keep-alive chunk interleaved with events.
    const stream = ': hi\n\ndata: ' + acceptedJson() + '\n\n: keepalive\n\n' + sse(terminalJson())

    // When: the consumer processes the stream.
    const eventTypes: string[] = []
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), {
      selection: 'both',
      onEvent: (event) => {
        eventTypes.push(event.type)
      },
    })

    // Then: only real events are forwarded and the terminal still ends the run.
    expect(eventTypes).toEqual(['accepted', 'terminal'])
    expect(outcome.kind).toBe('terminal')
  })

  it('ends in an actionable error when the stream ends without a terminal event', async () => {
    // Given: only accepted and progress, no terminal.
    const stream = sse(acceptedJson()) + sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"preparing","branch":null,"completed":0,"total":1}')

    // When: the consumer reaches EOF.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: a missing-terminal-event error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'missing-terminal-event' } })
  })

  it('ends in a local error on malformed JSON without echoing payload bytes', async () => {
    // Given: a truncated JSON payload carrying a secret-like marker.
    const secret = 'sk-do-not-echo-this-value'
    const stream = `data: {"secret":"${secret}"\n\n`

    // When: the consumer processes the stream.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: a malformed-json error is returned and never repeats the bytes.
    expect(outcome.kind).toBe('error')
    if (outcome.kind !== 'error') {
      return
    }
    expect(outcome.error.code).toBe('malformed-json')
    expect(outcome.error.message).not.toContain(secret)
  })

  it('ends in a local error when an event does not match the wire schema', async () => {
    // Given: a valid-JSON event with an unknown type.
    const stream = sse('{"type":"wonderful","payload":123}')

    // When: the consumer processes the stream.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: an unknown-event error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'unknown-event' } })
  })

  it('rejects an event whose taskId differs from the accepted UUID', async () => {
    // Given: an accepted event followed by a progress event with a different UUID.
    const stream = sse(acceptedJson())
      + sse('{"type":"progress","taskId":"11111111-2222-4333-8444-555555555555","stage":"preparing","branch":null,"completed":0,"total":1}')

    // When: the consumer processes the stream.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: a task-id-mismatch error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'task-id-mismatch' } })
  })

  it('rejects a duplicate accepted event', async () => {
    // Given: two accepted events.
    const stream = sse(acceptedJson()) + sse(acceptedJson())

    // When: the consumer processes the stream.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: a task-id-mismatch error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'task-id-mismatch' } })
  })

  it('rejects an event with no preceding accepted event', async () => {
    // Given: a terminal event arriving without a prior accepted event.
    const stream = sse(terminalJson())

    // When: the consumer processes the stream.
    const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })

    // Then: a task-id-mismatch error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'task-id-mismatch' } })
  })

  it('rejects a preview for a branch the selection did not choose', async () => {
    // Given: a translation-only selection but a deep-reading preview arrives.
    const stream = sse(acceptedJson('translation'))
      + sse('{"type":"preview","taskId":"' + TASK_ID + '","branch":"deep-reading","designation":"sample","paragraphs":["不应出现。"]}')

    // When: the consumer processes the stream with a translation selection.
    const outcome = await outcomeOf([stream], 'translation')

    // Then: a selection-mismatch error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'selection-mismatch' } })
  })

  it('rejects a terminal that marks an unselected branch non-not-selected', async () => {
    // Given: a translation-only selection, but its terminal marks deep-reading as failed.
    const stream = sse(acceptedJson('translation'))
      + sse('{"type":"terminal","taskId":"' + TASK_ID + '","outcome":"failed","branches":{"translation":"sample-ready","deep-reading":"failed"},"cleanup":"clean"}')

    // When: the consumer processes the stream.
    const outcome = await outcomeOf([stream], 'translation')

    // Then: a selection-mismatch error is returned.
    expect(outcome).toMatchObject({ kind: 'error', error: { code: 'selection-mismatch' } })
  })

  it('accepts a different accepted selection only if it matches the local selection', async () => {
    // Given: a deep-reading-only selection and an accepted event matching it.
    const stream = sse(acceptedJson('deep-reading'))
      + sse('{"type":"terminal","taskId":"' + TASK_ID + '","outcome":"succeeded","branches":{"translation":"not-selected","deep-reading":"sample-ready"},"cleanup":"clean"}')

    // When: the consumer processes the stream with a deep-reading selection.
    const outcome = await outcomeOf([stream], 'deep-reading')

    // Then: the run ends at the terminal.
    expect(outcome.kind).toBe('terminal')
  })

  it('consumes the provided stream exactly once', async () => {
    // Given: a counting source.
    const chunks = [sse(acceptedJson()), sse(terminalJson())]
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

    // When: the consumer runs to completion.
    const outcome = await consumePaperTaskStream(source, { selection: 'both' })

    // Then: the single provided stream is pulled exactly once to exhaustion.
    expect(iteratorStarts).toBe(1)
    expect(pulls).toBe(2)
    expect(outcome.kind).toBe('terminal')
  })

  it('reports a stable error-code vocabulary for every stream error', async () => {
    // Given: the five stream error paths.
    const errorStreams: Array<[string, PaperTaskStreamErrorCode]> = [
      ['data: {"broken"\n\n', 'malformed-json'],
      [sse('{"type":"nope"}'), 'unknown-event'],
      [sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"preparing","branch":null,"completed":0,"total":1}'), 'task-id-mismatch'],
      [sse(acceptedJson('both')) + sse('{"type":"progress","taskId":"11111111-2222-4333-8444-555555555555","stage":"generating","branch":"translation","completed":0,"total":1}'), 'task-id-mismatch'],
      [sse(acceptedJson('translation')) + sse('{"type":"preview","taskId":"' + TASK_ID + '","branch":"deep-reading","designation":"sample","paragraphs":["x"]}'), 'selection-mismatch'],
      [sse(acceptedJson('both')) + sse('{"type":"progress","taskId":"' + TASK_ID + '","stage":"preparing","branch":null,"completed":0,"total":1}'), 'missing-terminal-event'],
    ]

    // When: each stream is consumed with a both selection.
    const codes = await Promise.all(
      errorStreams.map(async ([stream, expectedCode]) => {
        const outcome = await consumePaperTaskStream(asyncChunks([stream]), { selection: 'both' })
        return outcome.kind === 'error' ? outcome.error.code : 'terminal'
      }),
    )

    // Then: the codes match the hand-written expectation order.
    expect(codes).toEqual(errorStreams.map(([, code]) => code))
  })
})