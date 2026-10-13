import { PAPER_TASK_ORIGIN_HEADER, type PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import { createError, getRequestHeader, getRequestHost, type H3Event } from 'h3'
import { consumeAttestedDevPeer } from '../utils/paper-review/dev-peer'
import { checkPaperReviewAccess } from '../utils/paper-review/gate'

let currentSettings: PaperTaskProviderSettings | undefined

export function getPaperTaskProviderSettings(): PaperTaskProviderSettings | undefined {
  return currentSettings === undefined ? undefined : { ...currentSettings }
}

export function replacePaperTaskProviderSettings(settings: PaperTaskProviderSettings): void {
  currentSettings = { ...settings }
}

export function clearPaperTaskProviderSettings(): void {
  currentSettings = undefined
}

export function hasExactPaperTaskProviderSettingsOrigin(origin: string | undefined, host: string | undefined): boolean {
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`)
}

export function requirePaperTaskProviderSettingsAccess(event: H3Event, dev: boolean): void {
  const origin = getRequestHeader(event, 'origin')
  const host = getRequestHost(event)
  const peer = dev ? consumeAttestedDevPeer(event) : undefined
  const access = checkPaperReviewAccess(dev, peer, host, origin)
  if (!access.ok) {
    throw createError({ statusCode: access.statusCode, message: access.message })
  }
  const sameOrigin = origin !== undefined && origin !== null && origin !== ''
    ? hasExactPaperTaskProviderSettingsOrigin(origin, host)
    : hasBrowserSameOriginEvidence(event, host)
  if (!sameOrigin) {
    throw createError({ statusCode: 403, message: '本机设置请求未通过访问校验。' })
  }
}

function hasBrowserSameOriginEvidence(event: H3Event, host: string | undefined): boolean {
  return getRequestHeader(event, 'sec-fetch-site') === 'same-origin'
    && hasExactPaperTaskProviderSettingsOrigin(getRequestHeader(event, PAPER_TASK_ORIGIN_HEADER), host)
}
