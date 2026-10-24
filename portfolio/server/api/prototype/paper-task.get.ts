import { createError, defineEventHandler, getRequestHeader, getRequestHost, setResponseHeaders } from 'h3'
import { consumeAttestedDevPeer } from '../../utils/paper-review/dev-peer'
import { checkPaperReviewAccess } from '../../utils/paper-review/gate'
import { paperTaskService } from '../../paper-task/instance'

/** Lists this process's retained paper tasks; it never includes task contents or credentials. */
export default defineEventHandler((event) => {
  const peer = import.meta.dev ? consumeAttestedDevPeer(event) : undefined
  const access = checkPaperReviewAccess(
    import.meta.dev,
    peer,
    getRequestHost(event),
    getRequestHeader(event, 'origin'),
  )
  if (!access.ok) {
    throw createError({ statusCode: access.statusCode, message: access.message })
  }

  setResponseHeaders(event, {
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  })
  return paperTaskService().history()
})
