import { PAPER_PDF_BYTE_CAP } from '../utils/paper-review/multipart'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'

const SOURCE_ACQUISITION_TIMEOUT_MS = 20_000
const MAX_SOURCE_REDIRECTS = 2
const ARXIV_HOST = 'arxiv.org'

export type PreparedPaperTaskSource = Extract<PaperTaskSourceResult, { readonly success: true }>

export type PaperTaskSourceLinkResult =
  | { readonly kind: 'ready'; readonly pdf: Uint8Array; readonly preparedSource: PreparedPaperTaskSource }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'cancelled' }

export type PaperTaskSourceFetch = (input: string | URL, init?: RequestInit) => Promise<Response>
export type PreparePaperTaskSource = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperTaskSourceResult>

export interface PaperTaskSourceAcquisitionOptions {
  readonly fetch?: PaperTaskSourceFetch
  readonly prepare?: PreparePaperTaskSource
  readonly signal?: AbortSignal
}

/**
 * Resolve one explicitly supplied arXiv paper link to a complete, prepared PDF.
 * No discovery or cross-paper search is performed. Other hosts and redirects
 * are rejected before they can be fetched.
 */
export async function resolvePaperTaskSourceLink(
  source: string,
  options: PaperTaskSourceAcquisitionOptions = {},
): Promise<PaperTaskSourceLinkResult> {
  const initialUrl = arxivPdfUrl(source, false)
  if (initialUrl === undefined) return { kind: 'unavailable' }
  if (options.signal?.aborted) return { kind: 'cancelled' }

  const signal = options.signal === undefined
    ? AbortSignal.timeout(SOURCE_ACQUISITION_TIMEOUT_MS)
    : AbortSignal.any([options.signal, AbortSignal.timeout(SOURCE_ACQUISITION_TIMEOUT_MS)])
  const fetchSource = options.fetch ?? fetch

  let response: Response | undefined
  let requestUrl = initialUrl
  try {
    for (let redirects = 0; redirects <= MAX_SOURCE_REDIRECTS; redirects += 1) {
      response = await fetchSource(requestUrl, {
        method: 'GET',
        headers: { accept: 'application/pdf' },
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal,
      })
      if (response.status < 300 || response.status > 399) break

      const location = response.headers.get('location')
      await cancelBody(response)
      if (location === null || redirects === MAX_SOURCE_REDIRECTS) {
        response = undefined
        break
      }
      const redirected = arxivPdfUrl(new URL(location, requestUrl).href, true)
      if (redirected === undefined) {
        response = undefined
        break
      }
      requestUrl = redirected
      response = undefined
    }
  } catch {
    return options.signal?.aborted ? { kind: 'cancelled' } : { kind: 'unavailable' }
  }

  if (options.signal?.aborted) return { kind: 'cancelled' }
  if (response === undefined || response.status !== 200 || !isPdfResponse(response)) {
    if (response !== undefined) await cancelBody(response)
    return { kind: 'unavailable' }
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > PAPER_PDF_BYTE_CAP) {
      await cancelBody(response)
      return { kind: 'unavailable' }
    }
  }

  const bytes = await readBoundedPdf(response, signal)
  if (bytes === undefined) {
    return options.signal?.aborted ? { kind: 'cancelled' } : { kind: 'unavailable' }
  }
  if (!hasPdfHeader(bytes)) return { kind: 'unavailable' }

  let prepared: PaperTaskSourceResult
  try {
    prepared = await (options.prepare ?? defaultPreparePaperTaskSource)(bytes, signal)
  } catch {
    return options.signal?.aborted ? { kind: 'cancelled' } : { kind: 'unavailable' }
  }
  if (options.signal?.aborted) return { kind: 'cancelled' }
  if (signal.aborted) return { kind: 'unavailable' }
  if (!isReliableFullText(prepared)) return { kind: 'unavailable' }

  return { kind: 'ready', pdf: bytes, preparedSource: prepared }
}

function arxivPdfUrl(value: string, redirect: boolean): URL | undefined {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ARXIV_HOST || parsed.port !== ''
    || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return undefined

  const match = /^\/(abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7}))(v\d+)?(?:\.pdf)?\/?$/u.exec(parsed.pathname)
  if (match === null || (redirect && match[1] !== 'pdf')) return undefined
  const [, , paperId, version = ''] = match
  return new URL(`https://${ARXIV_HOST}/pdf/${paperId}${version}`)
}

function isPdfResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  return contentType === 'application/pdf'
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
}

async function readBoundedPdf(response: Response, signal: AbortSignal): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader()
  if (reader === undefined) return undefined
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel()
        return undefined
      }
      const chunk = await reader.read()
      if (chunk.done) break
      if (chunk.value === undefined) continue
      length += chunk.value.byteLength
      if (length > PAPER_PDF_BYTE_CAP) {
        await reader.cancel()
        return undefined
      }
      chunks.push(chunk.value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return undefined
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function isReliableFullText(result: PaperTaskSourceResult): result is PreparedPaperTaskSource {
  return result.success
    && result.source.status === 'complete'
    && result.source.pageCount > 0
    && result.assets.every((asset) => asset.availability === 'available' && asset.bytes !== null)
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function defaultPreparePaperTaskSource(bytes: Uint8Array, signal?: AbortSignal): Promise<PaperTaskSourceResult> {
  const { preparePaperTaskSource } = await import('./source')
  return await preparePaperTaskSource(bytes, signal)
}
