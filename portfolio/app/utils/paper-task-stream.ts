/**
 * Browser-safe consumer for the paper-task `text/event-stream` response
 * (issue #40, translation and deep reading).
 *
 * The seam is an `AsyncIterable<string>` of decoded chunks — the page adapts
 * the `ReadableStream<Uint8Array>` from `Response.body` with a streaming
 * `TextDecoder`. This module never performs a fetch or a second request: it
 * consumes the single provided stream exactly once and stops at the first
 * terminal event.
 *
 * Every inbound event is validated twice: structurally against
 * `paperTaskEventSchema`, then semantically against the requested selection via
 * `validatePaperTaskEvent` (branch legality, unselected-branch invariants). The
 * stream must open with an `accepted` event, which fixes the task UUID; every
 * later event must carry the exact same UUID, so a mismatched or duplicate
 * `accepted` is a hard stream error rather than a silent re-target. Errors are
 * local and actionable and never echo untrusted payload bytes.
 */

import {
  paperTaskEventSchema,
  validatePaperTaskEvent,
  type PaperTaskEvent,
  type PaperTaskSelection,
} from './paper-task-contract'

export type PaperTaskStreamErrorCode =
  | 'malformed-json'
  | 'unknown-event'
  | 'selection-mismatch'
  | 'task-id-mismatch'
  | 'missing-terminal-event'

export interface PaperTaskStreamError {
  readonly type: 'stream-error'
  readonly code: PaperTaskStreamErrorCode
  readonly message: string
}

export type PaperTaskStreamOutcome =
  | { readonly kind: 'terminal'; readonly terminal: PaperTaskEvent }
  | { readonly kind: 'error'; readonly error: PaperTaskStreamError }

export interface PaperTaskStreamHandlers {
  /** The selection the page submitted; every event is validated against it. */
  readonly selection: PaperTaskSelection
  readonly onEvent?: (event: PaperTaskEvent) => void
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

function streamError(code: PaperTaskStreamErrorCode, message: string): PaperTaskStreamError {
  return { type: 'stream-error', code, message }
}

/**
 * Consumes a paper-task stream: opens with `accepted`, forwards
 * `progress`/`preview` events through `handlers.onEvent`, and stops at the
 * first `terminal` event. Any malformed, protocol-invalid, selection-invalid,
 * or UUID-inconsistent event — or end-of-stream without a terminal — yields a
 * local actionable error.
 */
export async function consumePaperTaskStream(
  source: AsyncIterable<string>,
  handlers: PaperTaskStreamHandlers,
): Promise<PaperTaskStreamOutcome> {
  const onEvent = handlers.onEvent ?? (() => {})
  let acceptedTaskId: string | null = null

  for await (const eventText of splitSseEvents(source)) {
    const payload = dataFromSseEvent(eventText)
    if (payload === null) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (jsonError) {
      if (!(jsonError instanceof SyntaxError)) {
        throw jsonError
      }
      return {
        kind: 'error',
        error: streamError('malformed-json', '任务端点返回了无法解析的流事件（JSON 格式错误），本次任务已中止。'),
      }
    }

    const schemaResult = paperTaskEventSchema.safeParse(parsed)
    if (!schemaResult.success) {
      return {
        kind: 'error',
        error: streamError('unknown-event', '任务端点返回了不符合协议的事件（类型或字段缺失），本次任务已中止。'),
      }
    }
    if (!validatePaperTaskEvent(parsed, handlers.selection)) {
      return {
        kind: 'error',
        error: streamError('selection-mismatch', '任务端点返回了与所选分支不符的事件，本次任务已中止。'),
      }
    }
    const event = schemaResult.data

    if (event.type === 'accepted') {
      if (acceptedTaskId !== null) {
        return {
          kind: 'error',
          error: streamError('task-id-mismatch', '任务端点重复开始了任务，本次任务已中止。'),
        }
      }
      acceptedTaskId = event.taskId
    } else if (acceptedTaskId === null || event.taskId !== acceptedTaskId) {
      return {
        kind: 'error',
        error: streamError('task-id-mismatch', '任务端点返回的任务编号不一致，本次任务已中止。'),
      }
    }

    onEvent(event)
    if (event.type === 'terminal') {
      return { kind: 'terminal', terminal: event }
    }
  }

  return {
    kind: 'error',
    error: streamError(
      'missing-terminal-event',
      '任务流已结束但未收到终止事件，结果不可用。请确认后端任务路由已实现，然后重新提交。',
    ),
  }
}
