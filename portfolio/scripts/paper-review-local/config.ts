/**
 * Local developer config for the paper-review prototype (issue #27).
 *
 * Reads the ignored `portfolio/.env.test.local` file (standardized agent
 * configuration) and parses it into a typed local object using
 * `node:util.parseEnv`. The parsed map is never merged into or read from
 * `process.env`; every field is copied into a fresh `PaperReviewLocalConfig`
 * value and validation failures surface as a typed error code so the CLI can
 * print a fixed, sanitized message (never the offending value).
 *
 * Required fields: LLM_MODEL_ID, LLM_API_KEY, LLM_BASE_URL, PDF_PATH.
 * Optional:      LLM_PROTOCOL (default `openai-completions`).
 * Provider label is derived as `new URL(LLM_BASE_URL).host`. A relative
 * PDF_PATH is resolved against the caller's working directory.
 */

import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import type { PaperReviewProtocol } from '../../server/utils/paper-review/harness'

/** Default wire protocol when LLM_PROTOCOL is absent. */
export const DEFAULT_LLM_PROTOCOL = 'openai-completions' as const

/**
 * Supported LLM_PROTOCOL values, mirrored from `harness.PAPER_REVIEW_PROTOCOLS`
 * (the source of truth for a hand-declared route). Kept local so the config
 * module stays dependency-free; the real pipeline rejects unsupported values
 * anyway, so this is a fast, safe pre-check, not the authority.
 */
const SUPPORTED_PROTOCOLS = ['openai-completions', 'anthropic-messages'] as const

export interface PaperReviewLocalConfig {
  readonly modelId: string
  readonly apiKey: string
  readonly baseUrl: string
  readonly protocol: PaperReviewProtocol
  /** Derived provider label: the host of LLM_BASE_URL. */
  readonly providerLabel: string
  /** Absolute path; a relative PDF_PATH is resolved against the caller's cwd. */
  readonly pdfPath: string
}

export type PaperReviewLocalConfigErrorCode =
  | 'config-malformed'
  | 'missing-model'
  | 'missing-api-key'
  | 'missing-base-url'
  | 'missing-pdf-path'
  | 'invalid-protocol'
  | 'invalid-base-url'

export type PaperReviewLocalConfigResult =
  | { readonly ok: true; readonly config: PaperReviewLocalConfig }
  | { readonly ok: false; readonly code: PaperReviewLocalConfigErrorCode }

/** Credential-like query keys that would smuggle a secret into a provider URL. */
const CREDENTIAL_QUERY_KEYS = [
  'key',
  'apikey',
  'accesstoken',
  'token',
  'password',
  'secret',
  'auth',
  'authorization',
  'credential',
  'clientsecret',
] as const

/** A provider URL is only supported as a bare http(s) URL with no userinfo. */
function isSafeProviderUrl(value: string): boolean {
  if (value.includes('@')) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }
  if (parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
    return false
  }
  return !Array.from(parsed.searchParams.keys()).some((key) => {
    const normalized = key.toLowerCase().replace(/[-_]/g, '')
    return CREDENTIAL_QUERY_KEYS.some((credentialKey) => credentialKey === normalized)
  })
}

/** A required field is present when it is a non-empty string. */
function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

function isSupportedProtocol(value: string): value is PaperReviewProtocol {
  return SUPPORTED_PROTOCOLS.some((supported) => supported === value)
}

/**
 * Parse the raw contents of the local env file into a validated config.
 * @param raw - the `.env.test.local` file text.
 * @param cwd - the working directory used to resolve a relative PDF_PATH.
 */
export function parseLocalConfig(raw: string, cwd: string): PaperReviewLocalConfigResult {
  let env: NodeJS.Dict<string>
  try {
    env = parseEnv(raw)
  } catch {
    return { ok: false, code: 'config-malformed' }
  }

  const modelId = env.LLM_MODEL_ID
  const apiKey = env.LLM_API_KEY
  const baseUrl = env.LLM_BASE_URL
  const pdfPath = env.PDF_PATH
  if (!present(modelId)) {
    return { ok: false, code: 'missing-model' }
  }
  if (!present(apiKey)) {
    return { ok: false, code: 'missing-api-key' }
  }
  if (!present(baseUrl)) {
    return { ok: false, code: 'missing-base-url' }
  }
  if (!present(pdfPath)) {
    return { ok: false, code: 'missing-pdf-path' }
  }

  const protocolRaw = env.LLM_PROTOCOL
  const protocol =
    protocolRaw !== undefined && protocolRaw.trim() !== '' ? protocolRaw.trim() : DEFAULT_LLM_PROTOCOL
  if (!isSupportedProtocol(protocol)) {
    return { ok: false, code: 'invalid-protocol' }
  }
  if (!isSafeProviderUrl(baseUrl)) {
    return { ok: false, code: 'invalid-base-url' }
  }

  const config: PaperReviewLocalConfig = {
    modelId: modelId.trim(),
    apiKey,
    baseUrl: baseUrl.trim(),
    protocol,
    providerLabel: new URL(baseUrl).host,
    pdfPath: resolve(cwd, pdfPath.trim()),
  }
  return { ok: true, config }
}