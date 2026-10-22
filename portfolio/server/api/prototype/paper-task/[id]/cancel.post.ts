import { createError, defineEventHandler, getRequestHeader, getRequestHost, getRouterParam } from 'h3'
import { paperTaskIdSchema } from '../../../../../app/utils/paper-task-contract'
import { consumeAttestedDevPeer } from '../../../../utils/paper-review/dev-peer'
import { checkPaperReviewAccess } from '../../../../utils/paper-review/gate'
import { paperTaskService } from '../../../../paper-task/instance'

/**
 * Development-only paper-task cancel endpoint (issue #40).
 *
 * Stops every owned process/runtime and awaits cleanup before responding. The
 * UUID path is attested by the parent dev-peer handler; this route re-checks
 * origin/loopback and rejects any non-UUID id as not-found.
 */
export default defineEventHandler(async (event) => {
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

  const id = getRouterParam(event, 'id')
  if (id === undefined || !paperTaskIdSchema.safeParse(id).success) {
    return { ok: false, code: 'not-found' }
  }

  return paperTaskService().cancel(id)
})