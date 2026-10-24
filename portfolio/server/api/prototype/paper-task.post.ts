import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestHost,
  readMultipartFormData,
  sendIterable,
  setResponseHeaders,
} from 'h3'
import { consumeAttestedDevPeer } from '../../utils/paper-review/dev-peer'
import { checkContentLength, checkPaperReviewAccess } from '../../utils/paper-review/gate'
import { observeRequestDisconnect } from '../../utils/paper-review/disconnect'
import { PAPER_PDF_BYTE_CAP } from '../../utils/paper-review/multipart'
import { parsePaperTaskMultipart, type PaperTaskPdfInput } from '../../paper-task/multipart'
import {
  resolvePaperTaskSourceLink,
  type PreparedPaperTaskSource,
} from '../../paper-task/source-acquisition'
import { paperTaskService } from '../../paper-task/instance'
import { renderPaperTaskSse } from '../../paper-task/sse'

/**
 * Development-only paper-task submission endpoint (issue #40).
 *
 * Fails closed before reading the body when the request is not a local dev
 * loopback request from the matching Origin, or when the Content-Length cannot
 * be safely validated. Otherwise it parses one `pdf` or `sourceUrl` plus the
 * `selection` field (no credentials), resolves a controlled paper link to one
 * reliable full-text PDF when supplied, streams the same task events, and ends
 * in one terminal event. Unsupported or incomplete linked sources fail before
 * task creation and direct users to the PDF upload fallback.
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

    let taskInput: PaperTaskPdfInput
    let preparedSource: PreparedPaperTaskSource | undefined
    if (parsed.input.sourceUrl !== null) {
      const resolved = await resolvePaperTaskSourceLink(parsed.input.sourceUrl, { signal: disconnect.signal })
      if (resolved.kind === 'cancelled') return
      if (resolved.kind === 'unavailable') {
        throw createError({ statusCode: 422, message: '无法从此链接取得可用的完整论文全文，请上传论文 PDF 继续。' })
      }
      taskInput = { pdf: resolved.pdf, selection: parsed.input.selection }
      preparedSource = resolved.preparedSource
    } else if (parsed.input.pdf !== null) {
      taskInput = { pdf: parsed.input.pdf, selection: parsed.input.selection }
    } else {
      throw createError({ statusCode: 400, message: '请提供一篇论文的链接或上传论文 PDF。' })
    }

    setResponseHeaders(event, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache',
    })

    const submissionOptions = parsed.input.sourceUrl === null
      ? {
          sourceTitle: uploadedPdfTitle(parts),
          ...(preparedSource === undefined ? {} : { preparedSource }),
        }
      : {
          sourceTitle: sourceLinkTitle(parsed.input.sourceUrl),
          ...(preparedSource === undefined ? {} : { preparedSource }),
        }
    const submission = await paperTaskService().submit(taskInput, submissionOptions)
    if (!submission.ok) {
      throw createError({ statusCode: submission.statusCode, message: submission.message })
    }
    await sendIterable(event, renderPaperTaskSse(submission.events))
  } finally {
    disconnect.dispose()
  }
})

function uploadedPdfTitle(parts: readonly { readonly name?: string; readonly filename?: string }[]): string {
  const filename = parts.find((part) => part.name === 'pdf')?.filename
  if (filename === undefined || filename.trim() === '') return '上传的论文 PDF'
  return filename.replace(/\\/gu, '/').split('/').at(-1) ?? '上传的论文 PDF'
}

function sourceLinkTitle(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl)
    return `${url.hostname}${url.pathname}`.slice(0, 200)
  } catch {
    return '链接论文'
  }
}
