import { createError, defineEventHandler, getRouterParam, send, setResponseHeader } from 'h3'
import { paperTaskService } from '../../../../../paper-task/instance'
import { requirePaperTaskSourceAccess } from '../../../../../paper-task/source-http'

export default defineEventHandler((event) => {
  const id = requirePaperTaskSourceAccess(event, import.meta.dev)
  const assetId = getRouterParam(event, 'asset')
  if (assetId === undefined || !/^asset-[0-9a-f]{32}$/.test(assetId)) {
    throw createError({ statusCode: 404, message: '原文裁切不可用。' })
  }
  const bytes = paperTaskService().asset(id, assetId)
  if (bytes === undefined) throw createError({ statusCode: 404, message: '原文裁切不可用。' })
  setResponseHeader(event, 'content-type', 'image/png')
  setResponseHeader(event, 'content-length', bytes.byteLength)
  return send(event, Buffer.from(bytes))
})
