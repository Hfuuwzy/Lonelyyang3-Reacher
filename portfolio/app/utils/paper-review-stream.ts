import { isPaperReviewStreamEvent } from './paper-review-contract'
import type {
  PaperReviewErrorEvent,
  PaperReviewStreamEvent,
} from './paper-review-contract'
import type { PaperReviewTaskResult } from './paper-review-task-contract'

/**
 * Browser-safe consumer for the paper-review `text/event-stream` response.
 *
 * The seam is an `AsyncIterable<string>` of decoded chunks (the page adapts the
 * `ReadableStream<Uint8Array>` from `Response.body` with a streaming
 * `TextDecoder`). This module never performs a fetch or a second request: it
 * consumes the single provided stream exactly once and stops at the first
 * terminal event (result or error).
 */

export type PaperReviewStreamErrorCode = 'malformed-json' | 'unknown-event' | 'missing-terminal-event'

export interface PaperReviewStreamError {
  readonly type: 'stream-error'
  readonly code: PaperReviewStreamErrorCode
  readonly message: string
}

export type PaperReviewStreamEventOrError = PaperReviewStreamEvent | PaperReviewStreamError

export type PaperReviewStreamOutcome =
  | { readonly kind: 'result'; readonly result: PaperReviewTaskResult }
  | { readonly kind: 'error'; readonly error: PaperReviewStreamError | PaperReviewErrorEvent }

export interface PaperReviewStreamHandlers {
  readonly onEvent?: (event: PaperReviewStreamEvent) => void
}

function assertNever(value: never): never {
  throw new Error(`unreachable paper-review stream event type: ${String(value)}`)
}

/** Extracts the joined `data:` field lines of a single SSE event. */
function dataFromSseEvent(eventText: string): string | null {
  const dataLines: string[] = []
  for (const line of eventText.split(/\r?\n/)) {
    if (line.startsWith(':')) {
      continue
    }
    if (line.startsWith('data:')) {
      // SSE strips exactly one leading space after the field name.
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null
}

/**
 * Yields blank-line-delimited SSE event bodies, tolerating events split across
 * arbitrary chunk boundaries and a final unterminated event at EOF. Comment and
 * keep-alive-only events are dropped.
 */
async function* splitSseEvents(source: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = ''
  for await (const chunk of source) {
    buffer += chunk
    while (true) {
      const delimiter = /\r?\n\r?\n/.exec(buffer)
      if (delimiter === null) {
        break
      }
      const eventText = buffer.slice(0, delimiter.index)
      buffer = buffer.slice(delimiter.index + delimiter[0].length)
      if (eventText.trim() !== '') {
        yield eventText
      }
    }
  }
  const remaining = buffer.trim()
  if (remaining !== '') {
    yield remaining
  }
}

function parsePaperReviewEvent(payload: string): PaperReviewStreamEventOrError {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    return {
      type: 'stream-error',
      code: 'malformed-json',
      message: '审阅端点返回了无法解析的流事件（JSON 格式错误），本次审阅已中止。',
    }
  }

  if (isPaperReviewStreamEvent(parsed)) {
    return parsed
  }

  return {
    type: 'stream-error',
    code: 'unknown-event',
    message: '审阅端点返回了不符合协议的事件（未知类型或字段缺失），本次审阅已中止。',
  }
}

/**
 * Consumes a paper-review stream until a terminal event (result or error), a
 * malformed/unknown event, or end-of-stream without a terminal event. Stage
 * events are forwarded through `handlers.onEvent` as they arrive.
 */
export async function consumePaperReviewStream(
  source: AsyncIterable<string>,
  handlers: PaperReviewStreamHandlers = {},
): Promise<PaperReviewStreamOutcome> {
  const onEvent = handlers.onEvent ?? (() => {})

  for await (const eventText of splitSseEvents(source)) {
    const payload = dataFromSseEvent(eventText)
    if (payload === null) {
      continue
    }

    const event = parsePaperReviewEvent(payload)
    if (event.type === 'stream-error') {
      return { kind: 'error', error: event }
    }

    onEvent(event)

    switch (event.type) {
      case 'stage':
        break
      case 'result':
        return { kind: 'result', result: event.result }
      case 'error':
        return { kind: 'error', error: event }
      default:
        return assertNever(event)
    }
  }

  return {
    kind: 'error',
    error: {
      type: 'stream-error',
      code: 'missing-terminal-event',
      message: '审阅流已结束但未收到 result 或 error 终止事件，本次审阅结果不可用。请确认后端审阅路由已实现，然后重新提交。',
    },
  }
}
