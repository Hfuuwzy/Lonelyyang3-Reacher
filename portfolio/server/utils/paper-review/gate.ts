/**
 * Fail-closed request gates for the paper-review prototype (issue #27).
 *
 * Both checks are pure and return a discriminated `ok`/`denial` result so the
 * H3 route can map a denial straight onto `createError`. Each denial carries a
 * safe Chinese message that never echoes request fields or values. The peer
 * address gate must run before the body is read and before any dependency is
 * invoked; the content-length gate must run before H3 buffers the payload.
 */

export interface PaperReviewGateDenial {
  readonly ok: false
  readonly statusCode: 400 | 403 | 404 | 413
  readonly code: string
  readonly message: string
}

export type PaperReviewGateResult =
  | { readonly ok: true }
  | PaperReviewGateDenial

/** A peer address (or the IPv4-mapped form) in the loopback 127/8 range. */
function isLoopback(ip: string): boolean {
  if (ip === '::1') {
    return true
  }
  return ip.startsWith('127.') || ip.startsWith('::ffff:127.')
}

/** An Origin is only trusted when it matches the request host's own URL. */
function isSameOrigin(origin: string, host: string): boolean {
  return origin === `http://${host}` || origin === `https://${host}`
}

/**
 * Local-only access gate: requires a dev build, a loopback peer, and (when an
 * Origin header is present) an Origin matching the request host. Production
 * builds and non-loopback peers fail closed with 404 so the endpoint is not
 * revealed; an unmatched Origin fails with 403. `X-Forwarded-For` is never
 * trusted here.
 */
export function checkPaperReviewAccess(
  dev: boolean,
  ip: string | undefined,
  host: string | undefined,
  origin: string | null | undefined,
): PaperReviewGateResult {
  if (!dev || ip === undefined || !isLoopback(ip)) {
    return {
      ok: false,
      statusCode: 404,
      code: 'not-local',
      message: '该审阅端点仅支持在本机开发环境中使用。',
    }
  }
  if (
    origin !== null &&
    origin !== undefined &&
    origin !== '' &&
    (host === undefined || host === '' || !isSameOrigin(origin, host))
  ) {
    return {
      ok: false,
      statusCode: 403,
      code: 'origin-mismatch',
      message: '请求来源与服务器地址不一致，已被拒绝。',
    }
  }
  return { ok: true }
}

/**
 * Content-length gate that runs before H3 buffers the multipart payload. A
 * missing, malformed, non-positive, or over-cap length is rejected so an
 * attacker cannot force an unbounded buffer allocation.
 */
export function checkContentLength(
  raw: string | null | undefined,
  byteCap: number,
): PaperReviewGateResult {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return {
      ok: false,
      statusCode: 400,
      code: 'missing-content-length',
      message: '上传请求缺少 Content-Length 头，无法校验大小，请重新提交。',
    }
  }
  if (!/^\d+$/.test(raw.trim())) {
    return {
      ok: false,
      statusCode: 400,
      code: 'invalid-content-length',
      message: '上传请求的 Content-Length 头无效，无法校验大小，请重新提交。',
    }
  }
  const bytes = Number(raw.trim())
  if (bytes <= 0 || Number.isNaN(bytes)) {
    return {
      ok: false,
      statusCode: 400,
      code: 'invalid-content-length',
      message: '上传请求的 Content-Length 头无效，无法校验大小，请重新提交。',
    }
  }
  if (bytes > byteCap) {
    return {
      ok: false,
      statusCode: 413,
      code: 'body-too-large',
      message: '上传内容超过大小上限，请压缩后重新提交。',
    }
  }
  return { ok: true }
}
