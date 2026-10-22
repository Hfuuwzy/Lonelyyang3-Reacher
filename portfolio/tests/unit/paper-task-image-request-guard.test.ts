/// <reference types="node" />
import { createCanvas } from '@napi-rs/canvas'
import { createServer, type Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaperTaskImageReason, PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskProviderProtocol } from '../../app/utils/paper-task-provider-contract'
import { decodePaperTaskPng, type PreparedPaperTaskImage } from '../../server/paper-task/image-input'
import { startPaperTaskImageGuard } from '../../server/paper-task/image-request-guard'

const providerServers: Server[] = []
const guards: Array<{ readonly close: () => Promise<void> }> = []
const contextOne = 'Approved context one'
const contextTwo = 'Approved context two'

async function image(width: number, height: number, context: string): Promise<PreparedPaperTaskImage> {
  const bytes = new Uint8Array(createCanvas(width, height).toBuffer('image/png'))
  const decoded = await decodePaperTaskPng(bytes)
  return { assetId: `asset-${String(width).padStart(32, '0')}`, recordId: `p1-r${width}`, revision: 1, context, data: Buffer.from(bytes).toString('base64'), ...decoded }
}

async function provider(): Promise<{ readonly baseUrl: string; readonly received: Array<{ readonly url: string | undefined; readonly body: string; readonly authorization: string | undefined }> }> {
  const received: Array<{ readonly url: string | undefined; readonly body: string; readonly authorization: string | undefined }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      received.push({ url: request.url, body: Buffer.concat(chunks).toString('utf8'), authorization: request.headers.authorization })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
  })
  providerServers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('provider test listener failed')
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, received }
}

async function guard(baseUrl: string, images: readonly PreparedPaperTaskImage[], onReceipt: (assetId: string, status: PaperTaskImageReceipt['status'], reason: PaperTaskImageReason | null) => void = () => undefined, protocol: PaperTaskProviderProtocol = 'openai-completions'): Promise<{ readonly baseUrl: string; readonly close: () => Promise<void> }> {
  const result = await startPaperTaskImageGuard({ provider: { baseUrl, protocol, apiKey: '' }, images, onReceipt })
  guards.push(result)
  return result
}

function prompt(imageData: string, textContext: string): string {
  return JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: `Please inspect ${textContext}` }, { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } }] }] })
}

afterEach(async () => {
  await Promise.all(guards.splice(0).map(value => value.close()))
  await Promise.all(providerServers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('paper-task image request loopback guard', () => {
  it('forwards Anthropic Messages requests to /v1/messages from a root Base URL', async () => {
    const upstream = await provider()
    const rootBaseUrl = new URL(upstream.baseUrl).origin
    const guarded = await guard(rootBaseUrl, [], undefined, 'anthropic-messages')
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] })

    const response = await fetch(`${guarded.baseUrl}/v1/messages`, { method: 'POST', body })

    expect(response.status).toBe(200)
    expect(upstream.received).toHaveLength(1)
    expect(upstream.received[0]?.url).toBe('/v1/messages')
    expect(upstream.received[0]?.body).toBe(body)
  })

  it('settles a response interrupted after provider headers without an unhandled stream error', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: incomplete\n\n')
      setImmediate(() => response.destroy())
    })
    providerServers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('provider fixture did not bind')
    const approved = await image(2, 3, contextOne)
    const guarded = await guard(`http://127.0.0.1:${address.port}/v1`, [approved])
    const response = await fetch(`${guarded.baseUrl}/chat/completions`, {
      method: 'POST', body: prompt(approved.data, contextOne), signal: AbortSignal.timeout(2000),
    })
    const outcome = await Promise.race([
      response.text().then(() => 'completed', () => 'interrupted'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 300)),
    ])
    expect(outcome).toBe('interrupted')
    await guarded.close()
  })

  it('forwards approved bytes keylessly and refuses paths outside the exact route', async () => {
    // Given a keyless guard and a real approved PNG with its request context.
    const upstream = await provider()
    const approved = await image(2, 3, contextOne)
    const guardResult = await guard(upstream.baseUrl, [approved])
    const body = prompt(approved.data, contextOne)

    // When the approved request and an arbitrary neighboring path are sent.
    const accepted = await fetch(`${guardResult.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const rejected = await fetch(`${guardResult.baseUrl}/unapproved`, { method: 'POST', body: '{}' })

    // Then only the approved request reaches the configured upstream unchanged.
    expect(accepted.status).toBe(200)
    expect(rejected.status).toBe(404)
    expect(upstream.received).toHaveLength(1)
    expect(upstream.received[0]?.body).toBe(body)
    expect(upstream.received[0]?.authorization).toBeUndefined()
  })

  it('forwards a later text-only history after the approved image was sent', async () => {
    // Given a guard whose first request carried the approved image.
    const upstream = await provider()
    const approved = await image(2, 3, contextOne)
    const guardResult = await guard(upstream.baseUrl, [approved])
    const withImage = await fetch(`${guardResult.baseUrl}/chat/completions`, { method: 'POST', body: prompt(approved.data, contextOne) })

    // When a later request after history compaction carries no image blocks.
    const textOnly = JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Continue after compaction.' }] }] })
    const followUp = await fetch(`${guardResult.baseUrl}/chat/completions`, { method: 'POST', body: textOnly })

    // Then the follow-up is forwarded instead of being rejected as missing images.
    expect(withImage.status).toBe(200)
    expect(followUp.status).toBe(200)
    expect(upstream.received).toHaveLength(2)
    expect(upstream.received[1]?.body).toBe(textOnly)
  })

  it('isolates route tokens, contexts, and expected images between guards', async () => {
    // Given two independent guards with distinct approved contexts and dimensions.
    const upstream = await provider()
    const firstImage = await image(2, 3, contextOne)
    const secondImage = await image(4, 3, contextTwo)
    const firstGuard = await guard(upstream.baseUrl, [firstImage])
    const secondGuard = await guard(upstream.baseUrl, [secondImage])

    // When the first image is sent through its own guard and the other guard.
    const requestBody = prompt(firstImage.data, contextOne)
    const firstResponse = await fetch(`${firstGuard.baseUrl}/chat/completions`, { method: 'POST', body: requestBody })
    const secondResponse = await fetch(`${secondGuard.baseUrl}/chat/completions`, { method: 'POST', body: requestBody })

    // Then the same native image is accepted only by its task-bound guard.
    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(400)
    expect(upstream.received).toHaveLength(1)
  })

  it('sanitizes non-success provider responses and reports provider failure', async () => {
    // Given a configured provider that responds with a credential-bearing failure body.
    const server = createServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'text/plain', 'www-authenticate': 'Bearer private-value' })
      response.end('private-value must not escape')
    })
    providerServers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('provider test listener failed')
    const approved = await image(2, 3, contextOne)
    const receipts: Array<{ readonly status: string; readonly reason: string | null }> = []
    const guarded = await guard(`http://127.0.0.1:${address.port}/v1`, [approved], (_assetId, status, reason) => receipts.push({ status, reason }))

    // When the approved request is forwarded to that provider.
    const response = await fetch(`${guarded.baseUrl}/chat/completions`, { method: 'POST', body: prompt(approved.data, contextOne) })
    const body = await response.text()

    // Then the error is sanitized and the asset is never reported as transported.
    expect(response.status).toBe(401)
    expect(body).toBe('{"error":"provider request failed"}')
    expect(receipts).toContainEqual({ status: 'blocked', reason: 'provider-failed' })
    expect(receipts).not.toContainEqual({ status: 'transported', reason: null })
  })

  it('identifies an expired upstream key without relaying the provider body or credentials', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json', 'www-authenticate': 'Bearer private-value' })
      response.end(JSON.stringify({ error: 'API key 已过期 private-value' }))
    })
    providerServers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('provider test listener failed')
    const guarded = await guard(`http://127.0.0.1:${address.port}/v1`, [])

    const response = await fetch(`${guarded.baseUrl}/chat/completions`, {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }), signal: AbortSignal.timeout(4000),
    })
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).toContain('API key expired')
    expect(body).not.toContain('private-value')
    expect(response.headers.get('www-authenticate')).toBeNull()
  })

  it.each(['oversized', 'unfinished'] as const)('bounds a %s provider error body and returns only the generic failure', async (mode) => {
    const server = createServer((_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json' })
      if (mode === 'oversized') response.end(JSON.stringify({ error: `API key expired ${'private-value'.repeat(600)}` }))
      else response.write('{"error":"API key expired private-value')
    })
    providerServers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('provider test listener failed')
    const guarded = await guard(`http://127.0.0.1:${address.port}/v1`, [])

    const response = await fetch(`${guarded.baseUrl}/chat/completions`, {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }), signal: AbortSignal.timeout(4000),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('{"error":"provider request failed"}')
  })

  it('sanitizes request-handler callback failures and closes the upstream request', async () => {
    // Given a provider and a guard whose receipt callback throws after upstream headers arrive.
    const upstream = await provider()
    const approved = await image(2, 3, contextOne)
    const guarded = await guard(upstream.baseUrl, [approved], () => { throw new Error('private callback detail') })

    // When an approved image request reaches the callback after upstream response headers.
    const response = await fetch(`${guarded.baseUrl}/chat/completions`, { method: 'POST', body: prompt(approved.data, contextOne) })
    const body = await response.text()

    // Then the handler returns a sanitized internal failure without echoing the exception.
    expect(response.status).toBe(500)
    expect(body).toBe('{"error":"image request failed"}')
    expect(body).not.toContain('private callback detail')
    expect(upstream.received).toHaveLength(1)
  })

  it('rejects an over-limit length header before forwarding', async () => {
    // Given a guard and a request larger than the full JSON body cap.
    const upstream = await provider()
    const guardResult = await guard(upstream.baseUrl, [])
    const oversized = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(24 * 1024 * 1024) }] })

    // When the oversized body is posted to the loopback route.
    const result = fetch(`${guardResult.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: oversized }).catch(() => undefined)
    await result

    // Then the configured provider receives no portion of that request.
    expect(upstream.received).toHaveLength(0)
  })

  it('rejects an over-limit chunked body before forwarding any bytes', async () => {
    // Given a guard and a chunked JSON body larger than its request cap.
    const upstream = await provider()
    const guardResult = await guard(upstream.baseUrl, [])
    const endpoint = new URL(`${guardResult.baseUrl}/chat/completions`)
    const oversized = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(24 * 1024 * 1024) }] })

    // When bytes are streamed without a content-length header.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, response => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      request.on('error', reject)
      request.end(oversized)
    })

    // Then the streaming cap rejects the request before upstream dispatch.
    expect(status).toBe(413)
    expect(upstream.received).toHaveLength(0)
  })

  it('aborts an in-flight upstream request and closes idempotently', async () => {
    // Given a provider that accepts a request but has not sent response headers.
    let notifyArrived = (): void => undefined
    const arrived = new Promise<void>(resolve => { notifyArrived = resolve })
    const server = createServer(request => {
      request.on('data', () => undefined)
      request.on('end', notifyArrived)
    })
    providerServers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('provider test listener failed')
    const approved = await image(2, 3, contextOne)
    const receipts: Array<{ readonly status: string; readonly reason: string | null }> = []
    const guarded = await guard(`http://127.0.0.1:${address.port}/v1`, [approved], (_assetId, status, reason) => receipts.push({ status, reason }))
    const pending = fetch(`${guarded.baseUrl}/chat/completions`, { method: 'POST', body: prompt(approved.data, contextOne) }).catch(() => undefined)
    await arrived

    // When the guard is closed before the upstream responds.
    await guarded.close()
    await guarded.close()
    await pending

    // Then in-flight assets are interrupted and the pending connection is released.
    expect(receipts).toContainEqual({ status: 'interrupted', reason: 'cancelled' })
  })

  it('shares one pending close promise and unregisters its abort listener', async () => {
    // Given a guard using an abort signal.
    const upstream = await provider()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const guarded = await startPaperTaskImageGuard({
      provider: { baseUrl: upstream.baseUrl, protocol: 'openai-completions', apiKey: '' },
      images: [],
      onReceipt: () => undefined,
      signal: controller.signal,
    })
    guards.push(guarded)

    // When two callers close the same guard concurrently.
    const firstClose = guarded.close()
    const secondClose = guarded.close()

    // Then both await the shared cleanup and the abort listener is removed.
    expect(secondClose).toBe(firstClose)
    await Promise.all([firstClose, secondClose])
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('closes the loopback listener when startup is already aborted', async () => {
    // Given an already-aborted startup signal.
    const controller = new AbortController()
    controller.abort()

    // When a guard is started with that signal.
    const startup = startPaperTaskImageGuard({ provider: { baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai-completions', apiKey: '' }, images: [], onReceipt: () => undefined, signal: controller.signal })

    // Then startup rejects after closing its temporary listener.
    await expect(startup).rejects.toMatchObject({ name: 'AbortError' })
  })
})
