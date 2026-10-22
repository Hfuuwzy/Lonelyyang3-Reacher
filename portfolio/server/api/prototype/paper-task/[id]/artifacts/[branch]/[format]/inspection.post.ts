import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { PAPER_TASK_BRANCHES } from '../../../../../../../../app/utils/paper-task-contract'
import { paperTaskService } from '../../../../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../../../../paper-task/source-http'

const pageSchema = z.object({
  page: z.number().int().positive(),
  status: z.enum(['passed', 'minor', 'blocked']),
  expected: z.string().trim().min(1).max(500),
  observed: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(500),
  reason: z.string().max(500).optional(),
}).strict()
const inspectionSchema = z.object({
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  expectedPageCount: z.number().int().positive().max(5000),
  pages: z.array(pageSchema).min(1).max(5000),
}).strict()

export default defineEventHandler(async (event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const branch = z.enum(PAPER_TASK_BRANCHES).safeParse(getRouterParam(event, 'branch'))
  const format = z.enum(['pdf']).safeParse(getRouterParam(event, 'format'))
  if (!branch.success || !format.success || branch.data !== 'translation') {
    throw createError({ statusCode: 404, message: '逐页检查仅适用于译文 PDF。' })
  }
  const body = inspectionSchema.safeParse(await readBody<unknown>(event))
  if (!body.success) throw createError({ statusCode: 400, message: '请为最终文档的每一页填写预期内容、实际观察和检查证据。' })
  try {
    const view = await paperTaskService().inspectArtifact(id, branch.data, format.data, body.data)
    if (view === undefined) throw createError({ statusCode: 404, message: '待检查文档已变化或不可用。' })
    return view
  } catch {
    throw createError({ statusCode: 409, message: '检查记录未保存：请确认当前文档版本和完整页码范围。' })
  }
})
