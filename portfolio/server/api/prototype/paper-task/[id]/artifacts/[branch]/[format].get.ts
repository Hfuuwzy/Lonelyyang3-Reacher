import { createError, defineEventHandler, getQuery, getRouterParam, send, setResponseHeader } from 'h3'
import { z } from 'zod'
import { PAPER_TASK_BRANCHES } from '../../../../../../../app/utils/paper-task-contract'
import { PAPER_TASK_EXPORT_FORMATS } from '../../../../../../../app/utils/paper-task-reader-contract'
import { paperTaskService } from '../../../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../../../paper-task/source-http'

const branchSchema = z.enum(PAPER_TASK_BRANCHES)
const formatSchema = z.enum(PAPER_TASK_EXPORT_FORMATS)
const CONTENT_TYPES = {
  markdown: 'text/markdown; charset=utf-8',
  assets: 'application/zip',
  pdf: 'application/pdf',
} as const

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const branch = branchSchema.safeParse(getRouterParam(event, 'branch'))
  const format = formatSchema.safeParse(getRouterParam(event, 'format'))
  if (!branch.success || !format.success) throw createError({ statusCode: 404, message: '导出文件不可用。' })
  const query = getQuery(event)
  const inspection = query.inspection === '1'
  const download = query.download === '1'
  const inspectedArtifactSha256 = query.artifactSha256
  if (inspection && format.data !== 'pdf') {
    throw createError({ statusCode: 400, message: '此格式不需要逐页检查副本。' })
  }
  if (inspection && (typeof inspectedArtifactSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(inspectedArtifactSha256))) {
    throw createError({ statusCode: 400, message: '检查副本缺少有效的 PDF 文件标识。' })
  }
  if (branch.data === 'deep-reading' && format.data === 'pdf') {
    throw createError({ statusCode: 404, message: '深读分支仅提供 Markdown 与受控资产。' })
  }
  const bytes = paperTaskService().artifact(id, branch.data, format.data, inspection ? 'inspection' : 'final')
  if (bytes === undefined) throw createError({ statusCode: 404, message: '导出文件尚未构建，或尚未通过对应格式检查。' })

  const status = paperTaskService().reader(id)?.documents.find((document) => document.branch === branch.data)?.formats[format.data]
  if (inspection && status?.artifactSha256 !== inspectedArtifactSha256) {
    throw createError({ statusCode: 409, message: '待检查 PDF 已变化，请刷新状态后重新打开检查。' })
  }
  const actualName = status?.fileName ?? `${branch.data}.${format.data}`
  const fileName = inspection ? `inspection-${actualName}` : actualName
  const attachment = format.data !== 'pdf' || download || (inspection && download)
  setResponseHeader(event, 'content-type', CONTENT_TYPES[format.data])
  setResponseHeader(event, 'content-length', bytes.byteLength)
  setResponseHeader(event, 'content-disposition', `${attachment ? 'attachment' : 'inline'}; filename="${fileName}"`)
  if (inspection) setResponseHeader(event, 'cache-control', 'no-store')
  return send(event, bytes)
})
