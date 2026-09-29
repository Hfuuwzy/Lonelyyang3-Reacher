/**
 * Semantic multipart parser for the paper-review prototype (issue #27).
 *
 * H3's `readMultipartFormData` returns raw byte parts; this module owns the
 * boundary: it recognises exactly the six allowed fields, rejects duplicate /
 * unknown / missing fields, multiple files, an empty PDF, a MIME other than
 * `application/pdf`, a missing `%PDF-` signature, oversized files, an invalid
 * provider URL (userinfo or credential query material), and unsupported
 * protocol / model / provider / key values. Input is parsed into a typed
 * `PaperReviewMultipartInput`; every failure is a safe, value-free message.
 */

import {
  PAPER_REVIEW_PROTOCOLS,
  type PaperReviewProtocol,
} from './harness'

/** Explicit per-request and per-file cap (50 MiB is acceptable). */
export const PAPER_PDF_BYTE_CAP = 50 * 1024 * 1024

/** A single multipart part, shaped to be structurally compatible with H3. */
export interface PaperReviewMultipartPart {
  readonly name?: string
  readonly filename?: string
  /** MIME content-type; H3 sets it only for file parts. */
  readonly type?: string
  readonly data: Uint8Array
}

export interface PaperReviewMultipartInput {
  readonly pdf: Uint8Array
  readonly providerLabel: string
  readonly baseUrl: string
  readonly protocol: PaperReviewProtocol
  readonly model: string
  readonly apiKey: string
}

export type PaperReviewMultipartErrorCode =
  | 'duplicate-field'
  | 'unknown-field'
  | 'extra-file'
  | 'missing-pdf'
  | 'duplicate-pdf'
  | 'empty-pdf'
  | 'invalid-mime'
  | 'invalid-signature'
  | 'file-too-large'
  | 'missing-required-field'
  | 'unsupported-protocol'
  | 'invalid-url'
  | 'unsupported-value'

export interface PaperReviewMultipartError {
  readonly code: PaperReviewMultipartErrorCode
  readonly message: string
}

export type PaperReviewMultipartResult =
  | { readonly success: true; readonly input: PaperReviewMultipartInput }
  | { readonly success: false; readonly error: PaperReviewMultipartError }

const REQUIRED_FIELDS = ['providerLabel', 'baseUrl', 'protocol', 'model', 'apiKey'] as const
const ALLOWED_FIELDS = new Set<string>(REQUIRED_FIELDS)

function isPaperReviewProtocol(value: string): value is PaperReviewProtocol {
  return PAPER_REVIEW_PROTOCOLS.some((protocol) => protocol === value)
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const // %PDF

/** A credential-like query key that would smuggle a secret into the URL. */
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

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === PDF_MAGIC[0] &&
    bytes[1] === PDF_MAGIC[1] &&
    bytes[2] === PDF_MAGIC[2] &&
    bytes[3] === PDF_MAGIC[3]
  )
}

/** A non-empty value free of control characters; used for labels and keys. */
function isSafeText(value: string): boolean {
  return value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
}

/**
 * A provider URL is only supported when it is a bare http(s) URL with no
 * userinfo and no credential-like query material.
 */
function isSafeProviderUrl(value: string, apiKey: string): boolean {
  if (value.includes('@') || value.includes(apiKey)) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (error) {
    if (error instanceof TypeError) {
      return false
    }
    throw error
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

function failure(code: PaperReviewMultipartErrorCode, message: string): PaperReviewMultipartResult {
  return { success: false, error: { code, message } }
}

/**
 * Parse and validate the raw multipart parts into a typed input. Any violation
 * of the field contract is an immediate typed failure; the PDF file and the
 * five text fields are then validated for size, signature, MIME, and supported
 * values.
 */
export function parsePaperReviewMultipart(
  parts: readonly PaperReviewMultipartPart[],
  byteCap: number,
): PaperReviewMultipartResult {
  const fields = new Map<string, string>()
  let pdf: Uint8Array | undefined
  let sawPdf = false

  for (const part of parts) {
    const name = part.name ?? ''
    if (name === '') {
      return failure('unknown-field', '上传请求包含无法识别的字段，请检查后重新提交。')
    }

    const isFile = typeof part.filename === 'string' && part.filename.length > 0
    if (isFile) {
      if (name !== 'pdf') {
        return failure('extra-file', '仅支持上传一个 PDF 文件，请移除多余文件后重新提交。')
      }
      if (sawPdf) {
        return failure('duplicate-pdf', '仅支持上传一个 PDF 文件，请检查后重新提交。')
      }
      sawPdf = true
      const mime = ((part.type ?? '').split(';')[0] ?? '').trim().toLowerCase()
      if (mime !== 'application/pdf') {
        return failure('invalid-mime', '上传的文件不是 application/pdf 格式，请上传有效的 PDF。')
      }
      const bytes = part.data
      if (bytes.length > byteCap) {
        return failure('file-too-large', '上传的 PDF 文件过大，请压缩后重新提交。')
      }
      if (bytes.length === 0) {
        return failure('empty-pdf', 'PDF 文件内容为空，请重新上传有效的 PDF。')
      }
      if (!hasPdfSignature(bytes)) {
        return failure('invalid-signature', '上传的文件不是有效的 PDF，请重新上传。')
      }
      pdf = bytes
      continue
    }

    if (!ALLOWED_FIELDS.has(name)) {
      return failure('unknown-field', '上传请求包含不支持的字段，请检查后重新提交。')
    }
    if (fields.has(name)) {
      return failure('duplicate-field', '上传请求包含重复字段，请检查后重新提交。')
    }
    fields.set(name, new TextDecoder().decode(part.data).trim())
  }

  if (pdf === undefined) {
    return failure('missing-pdf', '未提供 PDF 文件，请上传 PDF 后重新提交。')
  }

  const providerLabel = fields.get('providerLabel')
  const baseUrl = fields.get('baseUrl')
  const protocol = fields.get('protocol')
  const model = fields.get('model')
  const apiKey = fields.get('apiKey')
  if (
    providerLabel === undefined ||
    baseUrl === undefined ||
    protocol === undefined ||
    model === undefined ||
    apiKey === undefined
  ) {
    return failure('missing-required-field', '缺少必要的审阅参数，请补全后重新提交。')
  }

  if (!isPaperReviewProtocol(protocol)) {
    return failure('unsupported-protocol', '不支持的模型协议，请选择受支持的协议。')
  }
  if (!isSafeText(providerLabel) || !isSafeText(model) || !isSafeText(apiKey)) {
    return failure('unsupported-value', '审阅参数不受支持，请检查后重新提交。')
  }
  if (!isSafeProviderUrl(baseUrl, apiKey)) {
    return failure('invalid-url', '模型服务地址无效，请检查后重新提交。')
  }

  return {
    success: true,
    input: {
      pdf,
      providerLabel,
      baseUrl,
      protocol,
      model,
      apiKey,
    },
  }
}
