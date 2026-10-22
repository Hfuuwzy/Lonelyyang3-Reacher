import { Buffer } from 'node:buffer'
import { decodePaperTaskPng, type PreparedPaperTaskImage } from './image-input'
import { IMAGE_LIMITS, type PaperTaskImageReason } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskProviderProtocol } from '../../app/utils/paper-task-provider-contract'

export type PaperTaskImageWireLimits = {
  readonly maxBodyBytes: number
  readonly maxImages: number
  readonly maxImageBytes: number
  readonly maxRawImageBytes: number
  readonly maxBase64ImageBytes: number
  readonly maxPixels: number
  readonly maxDimension: number
}

export type PaperTaskImageWireInspection =
  | { readonly kind: 'valid'; readonly imageCount: number; readonly encodedBytes: number; readonly rawBytes: number }
  | { readonly kind: 'blocked'; readonly reason: PaperTaskImageReason | 'invalid-request' | 'remote-image-url' | 'unsupported-image-format' }

type ImagePayload = { readonly base64: string; readonly mediaType: string; readonly text: string }
type ImagePayloadResult = ImagePayload | Exclude<PaperTaskImageWireInspection, { readonly kind: 'valid' }>
type JsonObject = Record<string, unknown>
type ImageWireInspectionOptions = {
  readonly expectedImages?: readonly PreparedPaperTaskImage[]
  readonly limits?: PaperTaskImageWireLimits
  readonly allowPartialImages?: boolean
}

const DEFAULT_LIMITS: PaperTaskImageWireLimits = {
  maxBodyBytes: IMAGE_LIMITS.maxBodyBytes,
  maxImages: IMAGE_LIMITS.maxImages,
  maxImageBytes: IMAGE_LIMITS.maxImageBytes,
  maxRawImageBytes: IMAGE_LIMITS.maxRawImageBytes,
  maxBase64ImageBytes: IMAGE_LIMITS.maxBase64ImageBytes,
  maxPixels: IMAGE_LIMITS.maxPixels,
  maxDimension: IMAGE_LIMITS.maxDimension,
}

function objectValue(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function objects(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? value.filter(objectValue) : []
}

function pairedImageBlocks(value: unknown): readonly { readonly block: JsonObject; readonly text: string }[] {
  const pairs: { readonly block: JsonObject; readonly text: string }[] = []
  let text: string[] = []
  for (const block of objects(value)) {
    if (typeof block['type'] === 'string' && block['type'].includes('image')) {
      pairs.push({ block, text: text.join('\n') })
      text = []
    } else if (typeof block['text'] === 'string') {
      text.push(block['text'])
    }
  }
  return pairs
}

function imageUrl(value: unknown, text: string): ImagePayloadResult {
  if (typeof value !== 'string') return { kind: 'blocked', reason: 'invalid-image' }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (match === null) return { kind: 'blocked', reason: /^https?:/i.test(value) ? 'remote-image-url' : 'invalid-image' }
  return { mediaType: match[1] ?? '', base64: match[2] ?? '', text }
}

function protocolImages(protocol: PaperTaskProviderProtocol, body: JsonObject): readonly ImagePayloadResult[] {
  switch (protocol) {
    case 'openai-completions':
      return objects(body['messages']).flatMap(message => pairedImageBlocks(message['content']).flatMap<ImagePayloadResult>(({ block, text }) => {
        if (block['type'] !== 'image_url') return typeof block['type'] === 'string' && block['type'].includes('image') ? [{ kind: 'blocked', reason: 'unsupported-image-format' as const }] : []
        const image = block['image_url']
        return [imageUrl(objectValue(image) ? image['url'] : undefined, text)]
      }))
    case 'openai-responses':
      return objects(body['input']).flatMap(item => pairedImageBlocks(item['content']).flatMap(({ block, text }) => {
        if (block['type'] !== 'input_image') return typeof block['type'] === 'string' && block['type'].includes('image') ? [{ kind: 'blocked', reason: 'unsupported-image-format' as const }] : []
        return [imageUrl(block['image_url'], text)]
      }))
    case 'anthropic-messages':
      return objects(body['messages']).flatMap(message => pairedImageBlocks(message['content']).flatMap<ImagePayloadResult>(({ block, text }) => {
        if (block['type'] !== 'image') return typeof block['type'] === 'string' && block['type'].includes('image') ? [{ kind: 'blocked', reason: 'unsupported-image-format' as const }] : []
        const value = block['source']
        if (objectValue(value) && value['type'] === 'url') return [{ kind: 'blocked', reason: 'remote-image-url' as const }]
        if (!objectValue(value) || value['type'] !== 'base64') return [{ kind: 'blocked', reason: 'invalid-image' as const }]
        const source = value
        return [{ base64: typeof source['data'] === 'string' ? source['data'] : '', mediaType: typeof source['media_type'] === 'string' ? source['media_type'] : '', text }]
      }))
    default:
      return assertNever(protocol)
  }
}

function assertNever(value: never): never {
  throw new Error(`unsupported paper-task image protocol: ${String(value)}`)
}

function hasProtocolShape(protocol: PaperTaskProviderProtocol, body: JsonObject): boolean {
  switch (protocol) {
    case 'openai-completions':
    case 'anthropic-messages':
      return Array.isArray(body['messages'])
    case 'openai-responses':
      return Array.isArray(body['input']) || typeof body['input'] === 'string'
    default:
      return assertNever(protocol)
  }
}

export async function inspectPaperTaskImageRequest(
  protocol: PaperTaskProviderProtocol,
  serializedBody: Uint8Array,
  options: ImageWireInspectionOptions = {},
): Promise<PaperTaskImageWireInspection> {
  const expectedImages = options.expectedImages ?? []
  const limits = options.limits ?? DEFAULT_LIMITS
  if (serializedBody.byteLength > limits.maxBodyBytes) return { kind: 'blocked', reason: 'request-too-large' }
  let request: unknown
  try {
    request = JSON.parse(Buffer.from(serializedBody).toString('utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: 'blocked', reason: 'invalid-request' }
    throw error
  }
  if (!objectValue(request)) return { kind: 'blocked', reason: 'invalid-request' }
  const body = request
  if (!hasProtocolShape(protocol, body)) return { kind: 'blocked', reason: 'invalid-request' }
  if (expectedImages.length > limits.maxImages) return { kind: 'blocked', reason: 'too-many-images' }

  let imageCount = 0
  let encodedBytes = 0
  let rawBytes = 0
  const matchedImages = new Set<PreparedPaperTaskImage>()
  for (const payload of protocolImages(protocol, body)) {
    if ('kind' in payload) return payload
    if (payload.mediaType !== 'image/png') return { kind: 'blocked', reason: 'unsupported-image-format' }
    const bytes = Buffer.from(payload.base64, 'base64')
    if (bytes.toString('base64') !== payload.base64) return { kind: 'blocked', reason: 'invalid-image' }
    if (bytes.byteLength > limits.maxImageBytes) return { kind: 'blocked', reason: 'image-too-large' }
    let decoded: Awaited<ReturnType<typeof decodePaperTaskPng>>
    try {
      decoded = await decodePaperTaskPng(bytes)
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case 'image-too-large': return { kind: 'blocked', reason: 'image-too-large' }
          case 'image-too-many-pixels': return { kind: 'blocked', reason: 'image-too-many-pixels' }
          case 'image-dimension-too-large': return { kind: 'blocked', reason: 'image-dimension-too-large' }
          default: return { kind: 'blocked', reason: 'invalid-image' }
        }
      }
      throw error
    }
    if (decoded.width > limits.maxDimension || decoded.height > limits.maxDimension) return { kind: 'blocked', reason: 'image-dimension-too-large' }
    if (decoded.width * decoded.height > limits.maxPixels) return { kind: 'blocked', reason: 'image-too-many-pixels' }
    const match = expectedImages.find(image => !matchedImages.has(image) && image.width === decoded.width && image.height === decoded.height && image.pixelDigest === decoded.pixelDigest && payload.text.includes(image.context))
    if (match === undefined) return { kind: 'blocked', reason: expectedImages.length === 0 ? 'unexpected-image' : 'changed-image' }
    matchedImages.add(match)
    imageCount += 1
    encodedBytes += Buffer.byteLength(payload.base64, 'ascii')
    rawBytes += bytes.byteLength
    if (imageCount > limits.maxImages) return { kind: 'blocked', reason: 'too-many-images' }
    if (encodedBytes > limits.maxBase64ImageBytes || rawBytes > limits.maxRawImageBytes) return { kind: 'blocked', reason: 'aggregate-image-too-large' }
  }
  if (!options.allowPartialImages && expectedImages.length > 0 && imageCount !== expectedImages.length) {
    return { kind: 'blocked', reason: imageCount > expectedImages.length ? 'unexpected-image' : 'missing-image' }
  }
  return { kind: 'valid', imageCount, encodedBytes, rawBytes }
}
