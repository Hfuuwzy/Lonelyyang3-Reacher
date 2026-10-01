import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Request-scoped disconnect binding for the paper-review endpoint (issue #28).
 *
 * Observes premature peer disconnects on the raw Node request/response pair and
 * surfaces them as an `AbortSignal`. The signal aborts exactly when the body
 * never completes (`req` close with `!req.complete`) or the response never
 * finishes (`res` close with `!res.writableFinished`). A normal completed body
 * or a fully-written response never aborts. Register before reading the body so
 * a mid-body disconnect is observed; call `dispose()` when the request is done.
 */
export interface RequestDisconnect {
  readonly signal: AbortSignal
  readonly dispose: () => void
}

export function observeRequestDisconnect(
  req: IncomingMessage,
  res: ServerResponse,
): RequestDisconnect {
  const controller = new AbortController()

  // Guard defences: the socket may already be destroyed or aborted before the
  // listeners below are attached, so reflect that state immediately.
  if (req.destroyed || req.aborted) {
    controller.abort()
  }

  const onRequestClose = (): void => {
    if (!req.complete) {
      controller.abort()
    }
  }
  const onResponseClose = (): void => {
    if (!res.writableFinished) {
      controller.abort()
    }
  }

  req.on('close', onRequestClose)
  res.on('close', onResponseClose)

  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener('close', onRequestClose)
      res.removeListener('close', onResponseClose)
    },
  }
}