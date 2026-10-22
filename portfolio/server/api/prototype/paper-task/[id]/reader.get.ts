import { createError, defineEventHandler } from 'h3'
import { paperTaskService } from '../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const reader = paperTaskService().reader(id)
  if (reader === undefined) throw createError({ statusCode: 404, message: '阅读成果尚不可用。' })
  return reader
})
