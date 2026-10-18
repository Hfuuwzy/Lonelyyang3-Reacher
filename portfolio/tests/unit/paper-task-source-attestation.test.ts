/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createDevPeerParentHandler, PAPER_REVIEW_DEV_PEER_HEADER } from '../../server/utils/paper-review/dev-peer'

const ID = '123e4567-e89b-12d3-a456-426614174000'
const KEY = '7'.repeat(64)
const base = `/api/prototype/paper-task/${ID}`

function request(method: string, path: string, origin?: string) {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: '::1' })
  const req = new IncomingMessage(socket)
  req.method = method
  req.url = path
  req.headers.host = 'localhost:3000'
  if (origin !== undefined) req.headers.origin = origin
  const event = createEvent(req, new ServerResponse(req))
  return { req, event }
}

describe('prepared source route admission', () => {
  it.each([
    ['GET', `${base}/source`],
    ['PATCH', `${base}/source`],
    ['GET', `${base}/translation`],
    ['GET', `${base}/assets/asset-${'a'.repeat(32)}`],
  ])('attests only the exact %s prepared-material route', async (method, path) => {
    const { req, event } = request(method, path)
    await createDevPeerParentHandler(KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
  })

  it.each([
    ['POST', `${base}/source`],
    ['DELETE', `${base}/source`],
    ['POST', `${base}/translation`],
    ['GET', '/api/prototype/paper-task/not-a-uuid/translation'],
    ['GET', `${base}/assets/../original.pdf`],
    ['GET', '/api/prototype/paper-task/not-a-uuid/source'],
    ['GET', `${base}/assets/asset-${'a'.repeat(32)}/extra`],
  ])('does not attest an unsupported %s route', async (method, path) => {
    const { req, event } = request(method, path)
    await createDevPeerParentHandler(KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
  })

  it('rejects a foreign origin before signing access to retained materials', async () => {
    const { event } = request('GET', `${base}/source`, 'https://foreign.example')
    await expect(Promise.resolve().then(() => createDevPeerParentHandler(KEY)(event))).rejects.toMatchObject({ statusCode: 403 })
  })
})
