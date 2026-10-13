/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createPaperTaskProviderSettingsHandlers } from '../../server/paper-task/provider-settings-handlers'
import {
  clearPaperTaskProviderSettings,
  getPaperTaskProviderSettings,
} from '../../server/paper-task/provider-settings'
import { PAPER_TASK_ORIGIN_HEADER } from '../../app/utils/paper-task-provider-contract'
import {
  PAPER_REVIEW_DEV_PEER_HEADER,
  PAPER_REVIEW_DEV_PROOF_HEADER,
  PAPER_REVIEW_DEV_PEER_KEY_ENV,
  signDevPeerProof,
} from '../../server/utils/paper-review/dev-peer'

const testKey = Buffer.alloc(32, 9).toString('hex')
const host = 'localhost:3000'
const origin = `http://${host}`
const validBody = JSON.stringify({
  providerLabel: 'Example',
  baseUrl: 'https://api.example.test/v1',
  protocol: 'openai-completions',
  model: 'test-model',
  apiKey: 'secret-marker',
})

function makeEvent(method: string, options: { readonly origin?: string; readonly requestOrigin?: string; readonly secFetchSite?: string; readonly attest?: boolean; readonly body?: string; readonly contentLength?: string } = {}) {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: '::1' })
  const req = new IncomingMessage(socket)
  req.method = method
  req.url = '/api/prototype/paper-task-settings'
  const requestOrigin = options.origin === undefined ? origin : options.origin
  req.headers = {
    host,
    ...(requestOrigin === '' ? {} : { origin: requestOrigin }),
    ...(options.requestOrigin === undefined ? {} : { [PAPER_TASK_ORIGIN_HEADER]: options.requestOrigin }),
    ...(options.secFetchSite === undefined ? {} : { 'sec-fetch-site': options.secFetchSite }),
    ...(options.body === undefined ? {} : { 'content-length': options.contentLength ?? String(Buffer.byteLength(options.body)) }),
  }
  if (options.attest !== false) {
    req.headers[PAPER_REVIEW_DEV_PEER_HEADER] = '::1'
    req.headers[PAPER_REVIEW_DEV_PROOF_HEADER] = signDevPeerProof(testKey, method, host, requestOrigin, '::1')
  }
  if (options.body !== undefined) {
    req.push(options.body)
    req.push(null)
  }
  return createEvent(req, new ServerResponse(req))
}

afterEach(() => {
  clearPaperTaskProviderSettings()
  delete process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV]
})

describe('paper-task provider settings HTTP routes', () => {
  const handlers = createPaperTaskProviderSettingsHandlers(true)

  it('returns private no-store status without disclosing the key', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    const putEvent = makeEvent('PUT', { body: validBody })
    const putStatus = await handlers.put(putEvent)
    expect(JSON.stringify(putStatus)).not.toContain('secret-marker')
    expect(putEvent.node.res.getHeader('cache-control')).toBe('no-store')
    const getEvent = makeEvent('GET')
    const status = await handlers.get(getEvent)
    expect(status).toMatchObject({ configured: true, apiKeyConfigured: true })
    expect(JSON.stringify(status)).not.toContain('secret-marker')
    expect(getEvent.node.res.getHeader('cache-control')).toBe('no-store')
  })

  it('rejects missing and foreign origins before accepting a settings request', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', { origin: '' })))).rejects.toMatchObject({ statusCode: 403 })
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', { origin: 'http://evil.example' })))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('accepts a same-origin browser GET that omits the forbidden Origin header', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    const event = makeEvent('GET', {
      origin: '',
      requestOrigin: `http://${host}`,
      secFetchSite: 'same-origin',
    })
    const status = await handlers.get(event)
    expect(status).toMatchObject({ configured: false, apiKeyConfigured: false })
  })

  it('rejects a same-origin GET missing the custom origin header', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', { origin: '', secFetchSite: 'same-origin' })))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a same-origin GET with a foreign custom origin header', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', {
      origin: '',
      requestOrigin: 'http://evil.example',
      secFetchSite: 'same-origin',
    })))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a same-origin GET without a same-origin Sec-Fetch-Site signal', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', {
      origin: '',
      requestOrigin: `http://${host}`,
      secFetchSite: 'cross-site',
    })))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects unattested loopback requests', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await expect(Promise.resolve().then(() => handlers.get(makeEvent('GET', { attest: false })))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('enforces the actual body byte cap even when Content-Length under-reports it', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    const oversizedBody = `{"value":"${'x'.repeat(9000)}"}`
    const event = makeEvent('PUT', { body: oversizedBody, contentLength: '1' })
    await expect(handlers.put(event)).rejects.toMatchObject({ statusCode: 413 })
    expect(getPaperTaskProviderSettings()).toBeUndefined()
  })

  it('does not echo malformed request values in its response error', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    const marker = 'request-secret-marker'
    const invalidBody = JSON.stringify({ unexpected: marker })
    const event = makeEvent('PUT', { body: invalidBody })
    await expect(handlers.put(event)).rejects.toMatchObject({ statusCode: 400, message: '提供方设置字段无效。' })
  })

  it('clears settings without returning secret material and prevents caching', async () => {
    process.env[PAPER_REVIEW_DEV_PEER_KEY_ENV] = testKey
    await handlers.put(makeEvent('PUT', { body: validBody }))
    const event = makeEvent('DELETE')
    const result = await handlers.delete(event)
    expect(result).toEqual({ configured: false, apiKeyConfigured: false })
    expect(JSON.stringify(result)).not.toContain('secret-marker')
    expect(event.node.res.getHeader('cache-control')).toBe('no-store')
  })
})
