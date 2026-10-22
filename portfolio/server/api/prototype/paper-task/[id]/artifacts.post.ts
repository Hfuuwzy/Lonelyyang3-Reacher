import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { PAPER_TASK_BRANCHES } from '../../../../../app/utils/paper-task-contract'
import { PAPER_TASK_EXPORT_FORMATS } from '../../../../../app/utils/paper-task-reader-contract'
import { paperTaskService } from '../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../paper-task/source-http'

const requestSchema = z.object({
  branch: z.enum(PAPER_TASK_BRANCHES),
  formats: z.array(z.enum(PAPER_TASK_EXPORT_FORMATS)).min(1).max(PAPER_TASK_EXPORT_FORMATS.length),
}).strict().superRefine((request, context) => {
  if (new Set(request.formats).size !== request.formats.length) {
    context.addIssue({ code: 'custom', path: ['formats'], message: 'Duplicate formats are not supported.' })
  }
  if (request.branch === 'deep-reading' && request.formats.some((format) => format === 'pdf')) {
    context.addIssue({ code: 'custom', path: ['formats'], message: 'Deep-reading exports support Markdown and controlled assets only.' })
  }
})

/** Builds only the user-selected branch and formats; it never starts a download. */
export default defineEventHandler(async (event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const body = requestSchema.safeParse(await readBody<unknown>(event))
  if (!body.success) throw createError({ statusCode: 400, message: '请选择当前任务中的成果分支和支持的导出格式。' })
  const result = await paperTaskService().buildArtifacts(id, body.data.branch, body.data.formats)
  if (result === undefined) throw createError({ statusCode: 404, message: '所选分支的可读成果尚不可用。' })
  return result
})
