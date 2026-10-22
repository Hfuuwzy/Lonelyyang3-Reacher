import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { paperTaskService } from '../../../../paper-task/instance'
import { paperTaskSourceView } from '../../../../paper-task/source-access'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const source = paperTaskService().source(id)
  if (source === undefined) throw createError({ statusCode: 404, message: '原文资料尚不可用。' })
  setResponseHeader(event, 'x-paper-source-revision', source.revision)
  return paperTaskSourceView(id, source)
})
