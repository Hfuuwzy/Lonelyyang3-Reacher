import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestHost,
  getRequestIP,
  readMultipartFormData,
  sendIterable,
  setResponseHeaders,
} from 'h3'
import type { PaperReviewStreamEvent } from '../../../app/utils/paper-review-contract'
import { checkContentLength, checkPaperReviewAccess } from '../../utils/paper-review/gate'
import { PAPER_PDF_BYTE_CAP } from '../../utils/paper-review/multipart'
import { createPaperReviewEvents } from '../../utils/paper-review/pipeline'

/**
 * Development-only paper-review endpoint (issue #27).
 *
 * Fails closed before reading the body or invoking any dependency when the
 * request is not a local dev loopback request from the matching Origin, or when
 * the Content-Length cannot be safely validated. Otherwise it parses the
 * multipart form, streams the four ordered stage events, and ends in the
 * verifier's report or one error. `sendIterable` is called exactly once with a
 * single async generator that yields one `data: <JSON>\n\n` chunk per event.
 */
export default defineEventHandler(async (event) => {
  const access = checkPaperReviewAccess(
    import.meta.dev,
    getRequestIP(event, { xForwardedFor: false }),
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

  const parts = await readMultipartFormData(event)
  if (parts === undefined) {
    throw createError({ statusCode: 400, message: '上传请求不是有效的 multipart/form-data 格式。' })
  }

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-cache',
  })

  const stream = createPaperReviewEvents(parts)
  await sendIterable(event, renderSse(stream))
})

/** Map each stream event to one blank-line-delimited SSE chunk. */
async function* renderSse(events: AsyncIterable<PaperReviewStreamEvent>): AsyncGenerator<string> {
  for await (const event of events) {
    yield `data: ${JSON.stringify(event)}\n\n`
  }
}
