/**
 * Parent-to-worker peer attestation for the paper-review prototype (issue #27).
 *
 * In dev, Nuxt's parent dev server sees the ORIGINAL client socket, while the
 * worker that actually runs the route only ever sees the parent's loopback
 * proxy socket. The parent (registered first via `devHandlers.unshift`) strips
 * any client-supplied attestation headers, re-validates the original peer with
 * the unchanged access gate, and signs the peer with a per-process random key.
 * The worker consumes those headers and re-verifies the HMAC before the route
 * trusts the attested peer. Production never installs the parent handler, so
 * the route resolves no peer and the gate denies.
 *
 * The shared secret lives only in the private `PAPER_REVIEW_DEV_PEER_KEY`
 * process environment variable; it is never serialized into config, written to
 * disk, or exposed to a browser. No secret or digest is ever logged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError, eventHandler, getRequestHeader, getRequestHost, type EventHandler, type H3Event } from 'h3'
import { checkPaperReviewAccess } from './gate'

/** Private dev-only env var carrying the per-process attestation key. */
export const PAPER_REVIEW_DEV_PEER_KEY_ENV = 'PAPER_REVIEW_DEV_PEER_KEY'
/** Internal header carrying the attested original peer address. */
export const PAPER_REVIEW_DEV_PEER_HEADER = 'x-paper-review-dev-peer'
/** Internal header carrying the HMAC proof for the attested peer. */
export const PAPER_REVIEW_DEV_PROOF_HEADER = 'x-paper-review-dev-proof'

/** Wire-format version tag; parent and worker must serialize identical payloads. */
const PAPER_REVIEW_DEV_PEER_V1 = 'paper-review/dev-peer/v1'

/** Upper bound for an attested loopback address (longest IPv6 form is ~45 chars). */
const MAX_PEER_LENGTH = 64
/** A SHA-256 HMAC proof is exactly 64 lowercase hex characters. */
const PROOF_HEX_RE = /^[0-9a-f]{64}$/

/**
 * Sign the dev-peer proof: HMAC-SHA256 over the canonical payload.
 *
 * The payload is `JSON.stringify` of a fixed five-element array so both the
 * parent and worker produce byte-identical strings from the same inputs.
 */
export function signDevPeerProof(
  secret: string,
  method: string,
  host: string,
  origin: string | undefined,
  peer: string,
): string {
  const payload = JSON.stringify([PAPER_REVIEW_DEV_PEER_V1, method, host, origin ?? '', peer])
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Parent-side admission handler for the paper-review endpoint.
 *
 * Registered FIRST in the dev server so it runs before the worker proxy. It
 * strips any client-supplied attestation headers, admits only the exact
 * paper-review POST using the ORIGINAL socket address through the unchanged
 * gate, then (on admission) overwrites the headers with a freshly signed proof.
 * All other requests fall through unchanged.
 */
export function createDevPeerParentHandler(secret: string): EventHandler {
  return eventHandler((event) => {
    const req = event.node.req
    const headers = req.headers
    delete headers[PAPER_REVIEW_DEV_PEER_HEADER]
    delete headers[PAPER_REVIEW_DEV_PROOF_HEADER]

    // Exact route, ignoring query string.
    const pathname = (req.url ?? '/').split('?')[0]
    if (req.method !== 'POST' || pathname !== '/api/prototype/paper-review') {
      return
    }

    // Original socket only; never trust X-Forwarded-For or Host to prove a peer.
    const peer = req.socket?.remoteAddress
    const host = getRequestHost(event)
    const origin = getRequestHeader(event, 'origin')
    const access = checkPaperReviewAccess(true, peer, host, origin)
    if (!access.ok) {
      throw createError({ statusCode: access.statusCode, message: access.message })
    }

    if (peer !== undefined) {
      headers[PAPER_REVIEW_DEV_PEER_HEADER] = peer
      headers[PAPER_REVIEW_DEV_PROOF_HEADER] = signDevPeerProof(secret, req.method, host, origin, peer)
    }
  })
}

/**
 * Worker-side verifier: consume and validate the parent's attestation.
 *
 * Reads the two internal headers, removes them immediately, and returns the
 * attested original peer only when the proof is a valid HMAC over the current
 * request under the shared key. Any missing, repeated, malformed, oversized, or
 * non-matching input yields `undefined` so the route fails closed.
 */
export function consumeAttestedDevPeer(event: H3Event): string | undefined {
  const headers = event.node.req.headers
  const peer = headers[PAPER_REVIEW_DEV_PEER_HEADER]
  const proof = headers[PAPER_REVIEW_DEV_PROOF_HEADER]
  delete headers[PAPER_REVIEW_DEV_PEER_HEADER]
  delete headers[PAPER_REVIEW_DEV_PROOF_HEADER]

  // Missing or repeated (array) header values are rejected.
  if (typeof peer !== 'string' || typeof proof !== 'string') {
    return undefined
  }
  const peerValue = peer.trim()
  if (peerValue === '' || peerValue.length > MAX_PEER_LENGTH) {
    return undefined
  }
  // Malformed proof (not exactly 64 lowercase hex digits) is rejected.
  if (!PROOF_HEX_RE.test(proof)) {
    return undefined
  }

  const secret = process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV]
  if (!secret) {
    return undefined
  }

  const method = reqMethod(event)
  const host = getRequestHost(event)
  const origin = getRequestHeader(event, 'origin')
  const expected = signDevPeerProof(secret, method, host, origin, peerValue)
  const expectedDigest = Buffer.from(expected, 'hex')
  const actualDigest = Buffer.from(proof, 'hex')
  if (expectedDigest.length !== actualDigest.length || !timingSafeEqual(expectedDigest, actualDigest)) {
    return undefined
  }
  return peerValue
}

/** The request method (upper-cased) as used in the signed payload. */
function reqMethod(event: H3Event): string {
  return (event.node.req.method ?? 'GET').toUpperCase()
}
