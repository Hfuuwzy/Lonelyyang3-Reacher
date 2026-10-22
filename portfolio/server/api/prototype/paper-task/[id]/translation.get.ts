import { createError, defineEventHandler } from 'h3'
import { paperTaskService } from '../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const translation = paperTaskService().translation(id)
  if (translation === undefined) throw createError({ statusCode: 404, message: '翻译主稿尚不可用。' })
  return translation
})
