import { createError, getRequestHeader, getRequestHost, getRouterParam, setResponseHeaders, type H3Event } from 'h3'
import { paperTaskIdSchema } from '../../app/utils/paper-task-contract'
import { consumeAttestedDevPeer } from '../utils/paper-review/dev-peer'
import { checkPaperReviewAccess } from '../utils/paper-review/gate'

export function requirePaperTaskSourceAccess(event: H3Event, dev: boolean): string {
  const access = checkPaperReviewAccess(dev, dev ? consumeAttestedDevPeer(event) : undefined,
    getRequestHost(event), getRequestHeader(event, 'origin'))
  if (!access.ok) throw createError({ statusCode: access.statusCode, message: access.message })
  const id = paperTaskIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: '任务资料不存在。' })
  setResponseHeaders(event, { 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff' })
  return id.data
}
