import { createError, defineEventHandler, getQuery, getRouterParam, send, setResponseHeader } from 'h3'
import { paperTaskService } from '../../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../../paper-task/source-http'

const PDF_KINDS = new Set(['original', 'translated'])

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const kind = getRouterParam(event, 'kind')
  if (kind === undefined || !PDF_KINDS.has(kind)) {
    throw createError({ statusCode: 404, message: '论文 PDF 不可用。' })
  }
  const service = paperTaskService()
  const bytes = kind === 'original' ? service.originalPdf(id) : service.translatedPdf(id)
  if (bytes === undefined) throw createError({ statusCode: 404, message: '论文 PDF 不可用。' })

  const download = getQuery(event).download === '1'
  const filename = kind === 'original' ? 'original-paper.pdf' : 'translated-paper.pdf'
  setResponseHeader(event, 'content-type', 'application/pdf')
  setResponseHeader(event, 'content-length', bytes.byteLength)
  setResponseHeader(event, 'content-disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`)
  return send(event, Buffer.from(bytes))
})
