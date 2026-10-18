import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { IMAGE_LIMITS, type PaperTaskImageReason, type PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskProviderProtocol, PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import { inspectPaperTaskImageRequest } from './image-wire'
import type { PreparedPaperTaskImage } from './image-input'

type GuardProvider = Pick<PaperTaskProviderSettings, 'baseUrl' | 'protocol' | 'apiKey'>
type GuardStatus = PaperTaskImageReceipt['status']
type GuardOptions = {
	readonly provider: GuardProvider
	readonly images: readonly PreparedPaperTaskImage[]
	readonly onReceipt: (assetId: string, status: GuardStatus, reason: PaperTaskImageReason | null) => void
	readonly signal?: AbortSignal
}
type GuardResult = { readonly baseUrl: string; readonly close: () => Promise<void> }

const ENDPOINTS: Record<PaperTaskProviderProtocol, string> = {
	'openai-completions': '/chat/completions',
	'openai-responses': '/responses',
	'anthropic-messages': '/messages',
}
const BODY_LIMIT = IMAGE_LIMITS.maxBodyBytes
const UPSTREAM_TIMEOUT_MS = 120_000

function sendJson(response: ServerResponse, status: number): void {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' })
	response.end('{"error":"image request blocked"}')
}

function sendProviderFailure(response: ServerResponse, status: number): void {
	response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
	response.end('{"error":"provider request failed"}')
}

function sendInternalFailure(response: ServerResponse): void {
	response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' })
	response.end('{"error":"image request failed"}')
}

function receiptReason(reason: PaperTaskImageReason | 'invalid-request' | 'remote-image-url' | 'unsupported-image-format'): PaperTaskImageReason {
	switch (reason) {
		case 'invalid-request': return 'unreadable'
		case 'remote-image-url':
		case 'unsupported-image-format': return 'unsupported-protocol'
		default: return reason
	}
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
	const length = Number(request.headers['content-length'])
	if (Number.isFinite(length) && length > BODY_LIMIT) return undefined
	const chunks: Buffer[] = []
	let size = 0
	try {
		for await (const chunk of request) {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			size += bytes.byteLength
			if (size > BODY_LIMIT) return undefined
			chunks.push(bytes)
		}
	} catch (error) {
		if (error instanceof Error && 'code' in error && (error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE')) return undefined
		throw error
	}
	return Buffer.concat(chunks, size)
}

function endpointUrl(provider: GuardProvider): URL {
	const base = new URL(provider.baseUrl)
	const endpoint = ENDPOINTS[provider.protocol]
	if (!base.pathname.endsWith(endpoint)) base.pathname = `${base.pathname.replace(/\/$/, '')}${endpoint}`
	return base
}

function routePath(token: string, upstream: URL, protocol: PaperTaskProviderProtocol): string {
	const suffix = ENDPOINTS[protocol]
	const basePath = upstream.pathname.endsWith(suffix) ? upstream.pathname.slice(0, -suffix.length) : upstream.pathname
	return `${basePath.replace(/\/$/, '')}/${token}${suffix}`
}

function publicBaseUrl(address: string, token: string, upstream: URL, protocol: PaperTaskProviderProtocol): string {
	const suffix = ENDPOINTS[protocol]
	const endpointPath = upstream.pathname.endsWith(suffix) ? upstream.pathname.slice(0, -suffix.length) : upstream.pathname
	const path = `${endpointPath.replace(/\/$/, '')}/${token}`
	return `http://${address}${path}`
}

function textPromptExists(protocol: PaperTaskProviderProtocol, body: unknown): boolean {
	if (!isRecord(body)) return false
	const record = body
	let inputs: unknown
	switch (protocol) {
		case 'openai-responses':
			if (typeof record['input'] === 'string') return record['input'].trim().length > 0
			inputs = record['input']
			break
		case 'openai-completions':
		case 'anthropic-messages':
			inputs = record['messages']
			break
		default:
			return assertNever(protocol)
	}
	if (!Array.isArray(inputs)) return false
	return inputs.some((item: unknown) => {
		if (!isRecord(item)) return false
		const message = item
		if (message['role'] !== 'user') return false
		if (typeof message['content'] === 'string') return message['content'].trim().length > 0
		return Array.isArray(message['content']) && message['content'].some((block: unknown) => isRecord(block) && typeof block['text'] === 'string')
	})
}

function assertNever(value: never): never {
	throw new Error(`unsupported paper-task image protocol: ${String(value)}`)
}

function providerHeaders(provider: GuardProvider, request: IncomingMessage, body: Buffer): Record<string, string> {
	const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(body.byteLength) }
	switch (provider.protocol) {
		case 'anthropic-messages':
			if (provider.apiKey) headers['x-api-key'] = provider.apiKey
			if (typeof request.headers['anthropic-version'] === 'string') headers['anthropic-version'] = request.headers['anthropic-version']
			if (typeof request.headers['anthropic-beta'] === 'string') headers['anthropic-beta'] = request.headers['anthropic-beta']
			return headers
		case 'openai-completions':
		case 'openai-responses':
			if (provider.apiKey) headers['authorization'] = `Bearer ${provider.apiKey}`
			return headers
		default:
			return assertNever(provider.protocol)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isApprovedEndpoint(request: IncomingMessage, expectedHost: string, route: string): boolean {
	return request.method === 'POST' && request.headers.host === expectedHost && request.url === route
}

type ReceiptBatch = { readonly options: GuardOptions; readonly images: readonly PreparedPaperTaskImage[]; readonly sentAssets: Set<string> }

function finishTransfer(batch: ReceiptBatch, status: GuardStatus, reason: PaperTaskImageReason | null): void {
	for (const image of batch.images) {
		if (status === 'transported' && batch.sentAssets.has(image.assetId)) continue
		batch.options.onReceipt(image.assetId, status, reason)
		if (status === 'transported') batch.sentAssets.add(image.assetId)
	}
}

export async function startPaperTaskImageGuard(options: GuardOptions): Promise<GuardResult> {
	const upstream = endpointUrl(options.provider)
	const token = randomBytes(32).toString('hex')
	const route = routePath(token, upstream, options.provider.protocol)
	const activeSockets = new Set<import('node:net').Socket>()
	const sentAssets = new Set<string>()
	const activeTransfers = new Set<() => void>()
	const server: Server = createServer((request, response) => {
		let upstreamRequest: ClientRequest | undefined
		let upstreamTimeout: ReturnType<typeof setTimeout> | undefined
		let interruptTransfer: (() => void) | undefined
		const failHandler = (): void => {
			upstreamRequest?.destroy()
			if (upstreamTimeout !== undefined) clearTimeout(upstreamTimeout)
			if (interruptTransfer !== undefined) activeTransfers.delete(interruptTransfer)
			if (response.destroyed) return
			if (response.headersSent) response.destroy()
			else sendInternalFailure(response)
		}
		const handleRequest = async (): Promise<void> => {
			if (!isApprovedEndpoint(request, `127.0.0.1:${address.port}`, route)) {
				sendJson(response, 404)
				return
			}
			const body = await readBody(request)
			if (body === undefined) {
				finishTransfer({ options, images: options.images, sentAssets }, 'blocked', 'request-too-large')
				sendJson(response, 413)
				response.once('finish', () => request.destroy())
				return
			}
			let parsed: unknown
			try {
				parsed = JSON.parse(body.toString('utf8'))
			} catch (error) {
				if (error instanceof SyntaxError) {
					finishTransfer({ options, images: options.images, sentAssets }, 'blocked', 'unreadable')
					sendJson(response, 400)
					return
				}
				throw error
			}
			const userPromptExists = textPromptExists(options.provider.protocol, parsed)
			const inspection = await inspectPaperTaskImageRequest(options.provider.protocol, body, { expectedImages: userPromptExists ? options.images : [] })
			if (inspection.kind === 'blocked') {
				finishTransfer({ options, images: options.images, sentAssets }, 'blocked', receiptReason(inspection.reason))
				sendJson(response, inspection.reason === 'request-too-large' ? 413 : 400)
				return
			}

			const transport = upstream.protocol === 'https:' ? httpsRequest : httpRequest
			const dispatchedImages = userPromptExists && inspection.imageCount > 0 ? [...options.images] : []
			let transferSettled = false
			const finish = (status: GuardStatus, reason: PaperTaskImageReason | null): void => {
				if (transferSettled) return
				transferSettled = true
				finishTransfer({ options, images: dispatchedImages, sentAssets }, status, reason)
				activeTransfers.delete(interrupt)
			}
			const interrupt = (): void => finish('interrupted', 'cancelled')
			interruptTransfer = interrupt
			activeTransfers.add(interrupt)
			let upstreamHeadersReached = false
			upstreamRequest = transport(upstream, {
				method: 'POST',
				headers: providerHeaders(options.provider, request, body),
				timeout: UPSTREAM_TIMEOUT_MS,
			}, upstreamResponse => {
				try {
					upstreamHeadersReached = true
					const succeeded = upstreamResponse.statusCode !== undefined && upstreamResponse.statusCode >= 200 && upstreamResponse.statusCode < 300
					finish(succeeded ? 'transported' : 'blocked', succeeded ? null : 'provider-failed')
					upstreamResponse.on('end', () => {
						if (upstreamTimeout !== undefined) clearTimeout(upstreamTimeout)
					})
					upstreamResponse.on('close', () => {
						if (upstreamTimeout !== undefined) clearTimeout(upstreamTimeout)
					})
					upstreamResponse.once('error', () => response.destroy())
					const status = upstreamResponse.statusCode ?? 502
					if (!succeeded) {
						upstreamResponse.destroy()
						sendProviderFailure(response, status)
						return
					}
					const responseHeaders = Object.fromEntries(Object.entries(upstreamResponse.headers).filter(([name]) => ['content-type', 'cache-control', 'retry-after'].includes(name)))
					response.writeHead(status, responseHeaders)
					let responseBytes = 0
					upstreamResponse.on('data', chunk => {
						responseBytes += Buffer.byteLength(chunk)
						if (responseBytes > BODY_LIMIT) {
							upstreamResponse.destroy()
							response.destroy()
						}
					})
					upstreamResponse.pipe(response)
				} catch {
					failHandler()
				}
			})
			upstreamRequest.on('socket', socket => {
				activeSockets.add(socket)
				socket.once('close', () => activeSockets.delete(socket))
			})
			upstreamTimeout = setTimeout(() => upstreamRequest?.destroy(new Error('provider-timeout')), UPSTREAM_TIMEOUT_MS)
			upstreamRequest.on('timeout', () => upstreamRequest?.destroy(new Error('provider-timeout')))
			upstreamRequest.on('error', () => {
				try {
					if (upstreamTimeout !== undefined) clearTimeout(upstreamTimeout)
					finish('blocked', 'provider-failed')
					if (!response.headersSent) sendJson(response, 502)
				} catch {
					failHandler()
				}
			})
			request.on('aborted', () => {
				upstreamRequest?.destroy()
				try {
					if (!upstreamHeadersReached) finish('interrupted', 'cancelled')
				} catch {
					failHandler()
				}
			})
			upstreamRequest.end(body)
		}
		void handleRequest().catch(failHandler)
	})
	server.on('connection', socket => {
		activeSockets.add(socket)
		socket.once('close', () => activeSockets.delete(socket))
	})
	server.requestTimeout = UPSTREAM_TIMEOUT_MS
	server.headersTimeout = UPSTREAM_TIMEOUT_MS
	const address = await new Promise<{ readonly address: string; readonly port: number }>((resolve, reject) => {
		const onError = (error: Error): void => reject(error)
		server.once('error', onError)
		server.listen(0, '127.0.0.1', () => {
			server.off('error', onError)
			const binding = server.address()
			if (binding === null || typeof binding === 'string') {
				reject(new Error('loopback listener did not bind to TCP'))
				return
			}
			resolve({ address: '127.0.0.1', port: binding.port })
		})
	})
	let closePromise: Promise<void> | undefined
	let abortListener: (() => void) | undefined
	const close = (): Promise<void> => {
		closePromise ??= (async () => {
			if (abortListener !== undefined) options.signal?.removeEventListener('abort', abortListener)
			abortListener = undefined
			for (const interrupt of activeTransfers) interrupt()
			for (const socket of activeSockets) socket.destroy()
			await new Promise<void>(resolve => server.close(() => resolve()))
		})()
		return closePromise
	}
	if (options.signal?.aborted) {
		await close()
		throw new DOMException('paper-task image guard startup aborted', 'AbortError')
	}
	if (options.signal !== undefined) {
		abortListener = () => { void close() }
		options.signal.addEventListener('abort', abortListener, { once: true })
	}
	return { baseUrl: publicBaseUrl(`${address.address}:${address.port}`, token, upstream, options.provider.protocol), close }
}
