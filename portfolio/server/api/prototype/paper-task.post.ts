import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestHost,
  readMultipartFormData,
  sendIterable,
  setResponseHeaders,
} from 'h3'
import type { PaperTaskEvent } from '../../../app/utils/paper-task-contract'
import { consumeAttestedDevPeer } from '../../utils/paper-review/dev-peer'
import { checkContentLength, checkPaperReviewAccess } from '../../utils/paper-review/gate'
import { observeRequestDisconnect } from '../../utils/paper-review/disconnect'
import { PAPER_PDF_BYTE_CAP } from '../../utils/paper-review/multipart'
import { parsePaperTaskMultipart } from '../../paper-task/multipart'
import { paperTaskService } from '../../paper-task/instance'

/**
 * Development-only paper-task submission endpoint (issue #40).
 *
 * Fails closed before reading the body when the request is not a local dev
 * loopback request from the matching Origin, or when the Content-Length cannot
 * be safely validated. Otherwise it parses the multipart form (exactly `pdf`
 * and `selection`, no credentials), streams the frozen wire events, and ends in
 * one terminal event.
 */
export default defineEventHandler(async (event) => {
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

  const disconnect = observeRequestDisconnect(event.node.req, event.node.res)
  try {
    const parts = await readMultipartFormData(event)
    if (parts === undefined) {
      throw createError({ statusCode: 400, message: '上传请求不是有效的 multipart/form-data 格式。' })
    }
    const parsed = parsePaperTaskMultipart(parts, PAPER_PDF_BYTE_CAP)
    if (!parsed.success) {
      throw createError({ statusCode: 400, message: parsed.error.message })
    }

    setResponseHeaders(event, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache',
    })

    const submission = await paperTaskService().submit(parsed.input, { signal: disconnect.signal })
    if (!submission.ok) {
      throw createError({ statusCode: submission.statusCode, message: submission.message })
    }
    await sendIterable(event, renderSse(submission.events))
  } finally {
    disconnect.dispose()
  }
})

/** Map each stream event to one blank-line-delimited SSE chunk. */
async function* renderSse(events: AsyncIterable<PaperTaskEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    yield `data: ${JSON.stringify(event)}\n\n`
  }
}
