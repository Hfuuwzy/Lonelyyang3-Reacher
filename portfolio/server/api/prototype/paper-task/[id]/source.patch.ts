import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { paperTaskService } from '../../../../paper-task/instance'
import { paperTaskCorrectionSchema } from '../../../../paper-task/source-correction'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'
import { checkContentLength } from '../../../../utils/paper-review/gate'

export default defineEventHandler(async (event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const size = checkContentLength(getRequestHeader(event, 'content-length'), 64 * 1024)
  if (!size.ok) throw createError({ statusCode: size.statusCode, message: size.message })
  let payload: unknown
  try {
    payload = await readBody(event)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw createError({ statusCode: 400, message: '修正请求不是有效的 JSON 数据。' })
  }
  const correction = paperTaskCorrectionSchema.safeParse(payload)
  if (!correction.success) throw createError({ statusCode: 400, message: '修正字段或版本无效。' })
  const result = paperTaskService().correctSource(id, correction.data)
  switch (result.kind) {
    case 'corrected':
    case 'unchanged':
      return result
    case 'conflict':
      throw createError({ statusCode: 409, message: '原文版本已改变，请核对当前记录后再修正。' })
    case 'invalid':
      throw createError({ statusCode: 400, message: '只能修正现有可读记录，不能猜补缺失内容。' })
    case 'unavailable':
      throw createError({ statusCode: 409, message: '任务未完成清理或原文不可用，当前不能修正。' })
    default: {
      const exhaustive: never = result
      throw new Error(`unreachable correction result: ${String(exhaustive)}`)
    }
  }
})
