import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEvent, type H3Event } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import {
  consumeAttestedDevPeer,
  createDevPeerParentHandler,
  PAPER_REVIEW_DEV_PEER_KEY_ENV,
  PAPER_REVIEW_DEV_PEER_HEADER,
  PAPER_REVIEW_DEV_PROOF_HEADER,
  signDevPeerProof,
} from '../../server/utils/paper-review/dev-peer'
import { checkPaperReviewAccess } from '../../server/utils/paper-review/gate'

// Fixed 64-hex test keys; not secrets, only deterministic shared keys.
const TEST_KEY = Buffer.alloc(32, 7).toString('hex')
const OTHER_KEY = Buffer.alloc(32, 3).toString('hex')
const HOST = 'localhost:3000'
const ORIGIN = 'http://localhost:3000'
const X_FORWARDED_FOR = 'x-forwarded-for'

type HeaderMap = Record<string, string | string[] | undefined>

interface EventFixture {
  event: H3Event
  req: IncomingMessage
  res: ServerResponse
}

/**
 * Build a typed H3 in-memory event without listening or connecting. The socket
 * carries no real address; callers set `remoteAddress` via a defineProperty to
 * model the original peer, and leave it unset to model a missing peer.
 */
function makeEvent(fixture: {
  method?: string
  url?: string
  headers?: HeaderMap
  remoteAddress?: string
} = {}): EventFixture {
  const socket = new Socket()
  if (fixture.remoteAddress !== undefined) {
    Object.defineProperty(socket, 'remoteAddress', { value: fixture.remoteAddress, configurable: true })
  }
  const req = new IncomingMessage(socket)
  req.method = fixture.method ?? 'POST'
  req.url = fixture.url ?? '/api/prototype/paper-review'
  req.headers = { ...(fixture.headers ?? {}) }
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), req, res }
}

/** Run a (possibly synchronously-throwing) h3 parent handler as a rejection. */
function runParent(handler: ReturnType<typeof createDevPeerParentHandler>, event: H3Event): Promise<unknown> {
  return Promise.resolve().then(() => handler(event))
}

let previousKey: string | undefined

beforeEach(() => {
  previousKey = process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV]
  process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = TEST_KEY
})

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV]
  } else {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = previousKey
  }
})

describe('paper-task dev peer attestation', () => {
  const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'

  it('attests the paper-task submission POST', async () => {
    const { event, req } = makeEvent({
      method: 'POST',
      url: '/api/prototype/paper-task',
      remoteAddress: '::1',
      headers: { host: HOST, origin: ORIGIN },
    })
    await createDevPeerParentHandler(TEST_KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBe(
      signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
    )
  })

  it('attests the paper-task cancel POST for an exact UUID', async () => {
    const { event, req } = makeEvent({
      method: 'POST',
      url: `/api/prototype/paper-task/${TASK_ID}/cancel`,
      remoteAddress: '::1',
      headers: { host: HOST, origin: ORIGIN },
    })
    await createDevPeerParentHandler(TEST_KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBe(
      signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
    )
  })

  it('attests the paper-task delete DELETE for an exact UUID', async () => {
    const { event, req } = makeEvent({
      method: 'DELETE',
      url: `/api/prototype/paper-task/${TASK_ID}`,
      remoteAddress: '::1',
      headers: { host: HOST, origin: ORIGIN },
    })
    await createDevPeerParentHandler(TEST_KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBe(
      signDevPeerProof(TEST_KEY, 'DELETE', HOST, ORIGIN, '::1'),
    )
  })

  it.each([
    ['a non-UUID cancel path', 'POST', '/api/prototype/paper-task/not-a-uuid/cancel'],
    ['a non-UUID delete path', 'DELETE', '/api/prototype/paper-task/not-a-uuid'],
    ['a cancel DELETE', 'DELETE', `/api/prototype/paper-task/${TASK_ID}/cancel`],
    ['a submission DELETE', 'DELETE', '/api/prototype/paper-task'],
    ['a GET on the submission path', 'GET', '/api/prototype/paper-task'],
    ['an unknown paper-task path', 'POST', '/api/prototype/paper-task/extra/segment'],
  ])('leaves %s unattested so the worker gate denies it', async (_label, method, url) => {
    const { event, req } = makeEvent({
      method,
      url,
      remoteAddress: '::1',
      headers: { host: HOST, origin: ORIGIN },
    })
    await createDevPeerParentHandler(TEST_KEY)(event)
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })
})

describe('paper-review dev peer attestation', () => {
  it('attests and verifies a valid parent-to-worker handoff for a local peer', async () => {
    // Given: a local loopback request with a matching Origin.
    const { event: parentEvent, req: parentReq } = makeEvent({
      remoteAddress: '::1',
      headers: { host: HOST, origin: ORIGIN },
    })

    // When: the parent admits and signs it, then the worker verifies.
    await createDevPeerParentHandler(TEST_KEY)(parentEvent)
    const proof = signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1')
    expect(parentReq.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
    expect(parentReq.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBe(proof)

    const { event: workerEvent } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: proof,
      },
    })

    // Then: the worker returns the attested loopback peer.
    expect(consumeAttestedDevPeer(workerEvent)).toBe('::1')
  })

  it('rejects an unknown original remote with forged local headers, stripping them', async () => {
    // Given: a non-loopback original remote carrying forged local attestation headers.
    const { event, req } = makeEvent({
      remoteAddress: '203.0.113.9',
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: 'a'.repeat(64),
      },
    })

    // When: the parent admission gate runs on the original socket only.
    // Then: the request is denied 404 and the forged headers are stripped.
    await expect(
      runParent(createDevPeerParentHandler(TEST_KEY), event),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })

  it('rejects a missing original peer and ignores a spoofed X-Forwarded-For, stripping forged headers', async () => {
    // Given: no original socket peer (undefined), but forged internal headers
    // and a spoofed X-Forwarded-For claiming a loopback address.
    const { event, req } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [X_FORWARDED_FOR]: '::1',
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: 'a'.repeat(64),
      },
    })

    // When: the parent admission gate consults only the original socket.
    // Then: the spoofed peer is denied 404 and the forged headers are stripped.
    await expect(
      runParent(createDevPeerParentHandler(TEST_KEY), event),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })

  it('overwrites client-forged proofs with a real parent signature for a local peer', async () => {
    // Given: a local loopback request whose headers already claim a forged peer/proof.
    const forgedProof = 'a'.repeat(64)
    const { event, req } = makeEvent({
      remoteAddress: '::1',
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '10.0.0.5',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: forgedProof,
      },
    })

    // When: the parent admits and re-signs with the real shared key.
    await createDevPeerParentHandler(TEST_KEY)(event)

    // Then: the forged values are replaced by an authentic signature.
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBe('::1')
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).not.toBe(forgedProof)
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBe(
      signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
    )
  })

  it('denies a mismatched Origin with 403 before admission', async () => {
    // Given: a local loopback peer whose Origin does not match the Host.
    const { event } = makeEvent({
      remoteAddress: '::1',
      headers: { host: HOST, origin: 'http://evil.example' },
    })

    // When: the parent admission gate checks the Origin.
    // Then: the request is denied 403.
    await expect(
      runParent(createDevPeerParentHandler(TEST_KEY), event),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns undefined when the shared key is absent', () => {
    // Given: a valid handoff but no dev-only key in the environment.
    delete process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV]
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })

    // When: the worker verifies.
    // Then: it fails closed without a peer.
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('returns undefined when the proof header is missing, after stripping the headers', () => {
    const { event, req } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
      },
    })

    expect(consumeAttestedDevPeer(event)).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })

  it('returns undefined when the peer header is missing', () => {
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects a proof with the wrong digest', () => {
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: 'f'.repeat(64),
      },
    })
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects a proof signed for a different host', () => {
    const { event } = makeEvent({
      headers: {
        host: 'evil.example',
        origin: 'http://evil.example',
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects a proof signed for a different origin', () => {
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: 'http://evil.example',
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects a proof signed for a different method', () => {
    const { event, req } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'GET', HOST, ORIGIN, '::1'),
      },
    })
    req.method = 'POST'
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects a proof signed with a different worker key', () => {
    // Given: a proof signed with TEST_KEY, but the worker runs under OTHER_KEY.
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = OTHER_KEY
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })

    // When: the worker verifies under its own (different) key.
    // Then: the attestation is rejected.
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects an array-valued peer header', () => {
    const { event } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: ['::1', '::2'],
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })
    expect(consumeAttestedDevPeer(event)).toBeUndefined()
  })

  it('rejects an array-valued proof header, stripping the headers', () => {
    const { event, req } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: [
          signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
        ],
      },
    })

    expect(consumeAttestedDevPeer(event)).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })

  it('rejects a malformed or oversized peer', () => {
    const oversized = '1'.repeat(65)
    const { event: malformed } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: 'not-hex',
      },
    })
    expect(consumeAttestedDevPeer(malformed)).toBeUndefined()

    const { event: oversizedEvent } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: oversized,
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, oversized),
      },
    })
    expect(consumeAttestedDevPeer(oversizedEvent)).toBeUndefined()
  })

  it('consumes and removes both internal headers after a valid verification', () => {
    // Given: a valid handoff.
    const { event, req } = makeEvent({
      headers: {
        host: HOST,
        origin: ORIGIN,
        [PAPER_REVIEW_DEV_PEER_HEADER]: '::1',
        [PAPER_REVIEW_DEV_PROOF_HEADER]: signDevPeerProof(TEST_KEY, 'POST', HOST, ORIGIN, '::1'),
      },
    })

    // When: the worker verifies.
    consumeAttestedDevPeer(event)

    // Then: both internal headers are gone from the request.
    expect(req.headers[PAPER_REVIEW_DEV_PEER_HEADER]).toBeUndefined()
    expect(req.headers[PAPER_REVIEW_DEV_PROOF_HEADER]).toBeUndefined()
  })

  it('denies all access when not running in dev (production is closed)', () => {
    // Given: a production build (dev flag false) with an otherwise valid peer.
    const denial = checkPaperReviewAccess(false, '::1', HOST, null)

    // Then: the gate fails closed with 404 and never reveals the endpoint.
    expect(denial.ok).toBe(false)
    if (!denial.ok) {
      expect(denial.statusCode).toBe(404)
    }
  })
})