import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestHost,
  readMultipartFormData,
  sendIterable,
  setResponseHeaders,
} from 'h3'
import type { PaperReviewStreamEvent } from '../../../app/utils/paper-review-contract'
import { consumeAttestedDevPeer } from '../../utils/paper-review/dev-peer'
import { checkContentLength, checkPaperReviewAccess } from '../../utils/paper-review/gate'
import { observeRequestDisconnect } from '../../utils/paper-review/disconnect'
import { PAPER_PDF_BYTE_CAP } from '../../utils/paper-review/multipart'
import { createPaperReviewEvents } from '../../utils/paper-review/pipeline'

/**
 * Development-only paper-review endpoint (issues #27/#29).
 *
 * Fails closed before reading the body or invoking any dependency when the
 * request is not a local dev loopback request from the matching Origin, or when
 * the Content-Length cannot be safely validated. Otherwise it parses the
 * multipart form, streams the six ordered stage events, and ends in the
 * application-derived task result or one error. `sendIterable` is called exactly
 * once with a single async generator that yields one `data: <JSON>\n\n` chunk
 * per event.
 */
export default defineEventHandler(async (event) => {
  // The worker only ever sees the parent's loopback proxy socket, so the peer
  // address must come from the parent-attested header. In production there is
  // no parent signer, so the peer resolves to undefined and the gate denies.
  const peer = import.meta.dev ? consumeAttestedDevPeer(event) : undefined
  const access = checkPaperReviewAccess(
    import.meta.dev,
    peer,
    getRequestHost(event),
    getRequestHeader(event, 'origin'),
  )
  if (!access.ok) {
    throw createError({ statusCode: access.statusCode, message: access.message })
  }

  const size = checkContentLength(getRequestHeader(event, 'content-length'), PAPER_PDF_BYTE_CAP)
  if (!size.ok) {
    throw createError({ statusCode: size.statusCode, message: size.message })
  }

  // Register the disconnect binding before reading the body so a mid-body
  // disconnect aborts this invocation only. The signal flows through the
  // pipeline; listeners are disposed on every exit path below.
  const disconnect = observeRequestDisconnect(event.node.req, event.node.res)
  try {
    const parts = await readMultipartFormData(event)
    if (parts === undefined) {
      throw createError({ statusCode: 400, message: '上传请求不是有效的 multipart/form-data 格式。' })
    }

    setResponseHeaders(event, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache',
    })

    const stream = createPaperReviewEvents(parts, {}, { signal: disconnect.signal })
    await sendIterable(event, renderSse(stream))
  } finally {
    disconnect.dispose()
  }
})

/** Map each stream event to one blank-line-delimited SSE chunk. */
async function* renderSse(events: AsyncIterable<PaperReviewStreamEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    yield `data: ${JSON.stringify(event)}\n\n`
  }
}
