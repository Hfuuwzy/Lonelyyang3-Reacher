import { createError, defineEventHandler, sendIterable, setResponseHeaders } from 'h3'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'
import { paperTaskService } from '../../../../paper-task/instance'
import { renderPaperTaskSse } from '../../../../paper-task/sse'

/** Opens a replaying observation stream for an existing task without submitting or restarting it. */
export default defineEventHandler(async (event) => {
  const taskId = requirePaperTaskSourceAccess(event, import.meta.dev)
  const events = paperTaskService().events(taskId)
  if (events === undefined) throw createError({ statusCode: 404, message: '任务不存在。' })

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-cache',
  })
  await sendIterable(event, renderPaperTaskSse(events))
})
