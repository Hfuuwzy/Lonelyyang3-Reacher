import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { decodePaperTaskPng, type PreparedPaperTaskImage } from '../../server/paper-task/image-input'
import { inspectPaperTaskImageRequest } from '../../server/paper-task/image-wire'

const png = new Uint8Array(createCanvas(2, 3).toBuffer('image/png'))
const context = 'Approved source figure context'

async function preparedImage(bytes: Uint8Array = png, imageContext = context): Promise<PreparedPaperTaskImage> {
  const decoded = await decodePaperTaskPng(bytes)
  return { assetId: 'asset-0123456789abcdef0123456789abcdef', recordId: 'p1-r1', revision: 2, context: imageContext, data: Buffer.from(bytes).toString('base64'), ...decoded }
}

function requestFor(protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages', data: string, imageContext = context): unknown {
  const text = `Analyze this figure. ${imageContext}`
  switch (protocol) {
    case 'openai-completions': return { messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }] }] }
    case 'openai-responses': return { input: [{ role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: `data:image/png;base64,${data}` }] }] }
    case 'anthropic-messages': return { messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }] }
    default: return assertNever(protocol)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected paper-task image protocol: ${String(value)}`)
}

describe('paper-task provider image wire inspection', () => {
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as const)('rejects swapped images between local source contexts for %s', async protocol => {
    const first = await preparedImage(png, 'Original equation (1)')
    const secondPng = new Uint8Array(createCanvas(3, 2).toBuffer('image/png'))
    const second = { ...await preparedImage(secondPng, 'Original equation (2)'), assetId: 'asset-1123456789abcdef0123456789abcdef', recordId: 'p1-r2' }
    const imageBlock = (data: string) => protocol === 'anthropic-messages'
      ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
      : protocol === 'openai-responses'
        ? { type: 'input_image', image_url: `data:image/png;base64,${data}` }
        : { type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }
    const body = (left: string, right: string) => {
      const content = [
        { type: protocol === 'openai-responses' ? 'input_text' : 'text', text: first.context }, imageBlock(left),
        { type: protocol === 'openai-responses' ? 'input_text' : 'text', text: second.context }, imageBlock(right),
      ]
      return Buffer.from(JSON.stringify(protocol === 'openai-responses' ? { input: [{ role: 'user', content }] } : { messages: [{ role: 'user', content }] }))
    }
    const expectedImages = [first, second]
    expect(await inspectPaperTaskImageRequest(protocol, body(first.data, second.data), { expectedImages }))
      .toMatchObject({ kind: 'valid', imageCount: 2 })
    expect(await inspectPaperTaskImageRequest(protocol, body(second.data, first.data), { expectedImages }))
      .toMatchObject({ kind: 'blocked', reason: 'changed-image' })
  })

  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as const)('decodes real serialized %s image blocks', async protocol => {
    // Given the protocol's native image representation containing a real PNG.
    const image = await preparedImage()
    const body = Buffer.from(JSON.stringify(requestFor(protocol, image.data)))

    // When the complete serialized request is inspected against the approved image.
    const result = await inspectPaperTaskImageRequest(protocol, body, { expectedImages: [image] })

    // Then the real PNG bytes and image context are admitted.
    expect(result).toEqual({ kind: 'valid', imageCount: 1, encodedBytes: Buffer.byteLength(image.data), rawBytes: png.byteLength })
  })

  it('rejects remote URLs and malformed image payloads instead of treating paths as images', async () => {
    // Given remote and malformed native image blocks, plus a text path without an image block.
    const remote = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }] }))
    const malformed = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }] }))
    const invalidRequest = Buffer.from('{}')
    const pathOnly = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'See /tmp/figure.png' }] }))

    // When each serialized request is inspected.
    const remoteResult = await inspectPaperTaskImageRequest('openai-completions', remote)
    const malformedResult = await inspectPaperTaskImageRequest('openai-completions', malformed)
    const invalidRequestResult = await inspectPaperTaskImageRequest('openai-completions', invalidRequest)
    const pathResult = await inspectPaperTaskImageRequest('openai-completions', pathOnly)

    // Then only real inline image content is counted.
    expect(remoteResult).toMatchObject({ kind: 'blocked', reason: 'remote-image-url' })
    expect(malformedResult).toMatchObject({ kind: 'blocked', reason: 'invalid-image' })
    expect(invalidRequestResult).toMatchObject({ kind: 'blocked', reason: 'invalid-request' })
    expect(pathResult).toMatchObject({ kind: 'valid', imageCount: 0 })
  })

  it('rejects missing, unexpected, and misassociated images for user prompts', async () => {
    // Given a valid image approved for a specific context.
    const image = await preparedImage()
    const missing = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: `Analyze this. ${context}` }] }))
    const wrongContext = Buffer.from(JSON.stringify(requestFor('openai-completions', image.data, 'Different figure')))
    const separateContext = Buffer.from(JSON.stringify({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'Analyze this figure.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } }] },
      { role: 'user', content: context },
    ] }))
    const unexpectedImage = Buffer.from(JSON.stringify(requestFor('openai-completions', image.data)))

    // When image-bearing and text-only requests are compared with their approvals.
    const missingResult = await inspectPaperTaskImageRequest('openai-completions', missing, { expectedImages: [image] })
    const wrongContextResult = await inspectPaperTaskImageRequest('openai-completions', wrongContext, { expectedImages: [image] })
    const separateContextResult = await inspectPaperTaskImageRequest('openai-completions', separateContext, { expectedImages: [image] })
    const unexpectedResult = await inspectPaperTaskImageRequest('openai-completions', unexpectedImage)

    // Then the guard requires the approved image-context association.
    expect(missingResult).toMatchObject({ kind: 'blocked', reason: 'missing-image' })
    expect(wrongContextResult).toMatchObject({ kind: 'blocked', reason: 'changed-image' })
    expect(separateContextResult).toMatchObject({ kind: 'blocked', reason: 'changed-image' })
    expect(unexpectedResult).toMatchObject({ kind: 'blocked', reason: 'unexpected-image' })
  })

  it('allows later compacted history to omit already-approved images', async () => {
    // Given an approved image and histories that retain none or one of its blocks.
    const image = await preparedImage()
    const textOnly = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: `Analyze this. ${context}` }] }))
    const subset = Buffer.from(JSON.stringify(requestFor('openai-completions', image.data)))

    // When the guard tolerates partial history after compaction.
    const empty = await inspectPaperTaskImageRequest('openai-completions', textOnly, { expectedImages: [image], allowPartialImages: true })
    const one = await inspectPaperTaskImageRequest('openai-completions', subset, { expectedImages: [image], allowPartialImages: true })

    // Then absent images are allowed while a present image must still match.
    expect(empty).toMatchObject({ kind: 'valid', imageCount: 0 })
    expect(one).toMatchObject({ kind: 'valid', imageCount: 1 })
  })

  it('rejects changed decoded pixels even when dimensions and context are unchanged', async () => {
    // Given two images with the same dimensions but different pixel colors.
    const originalCanvas = createCanvas(2, 3)
    originalCanvas.getContext('2d').fillStyle = '#000000'
    originalCanvas.getContext('2d').fillRect(0, 0, 2, 3)
    const changedCanvas = createCanvas(2, 3)
    changedCanvas.getContext('2d').fillStyle = '#ffffff'
    changedCanvas.getContext('2d').fillRect(0, 0, 2, 3)
    const original = await preparedImage(new Uint8Array(originalCanvas.toBuffer('image/png')))
    const changed = Buffer.from(changedCanvas.toBuffer('image/png')).toString('base64')

    // When a request associates the changed pixels with the approved context.
    const result = await inspectPaperTaskImageRequest('openai-completions', Buffer.from(JSON.stringify(requestFor('openai-completions', changed))), { expectedImages: [original] })

    // Then the image must not match the approved decoded pixels.
    expect(result).toMatchObject({ kind: 'blocked', reason: 'changed-image' })
  })

  it('rejects a complete serialized request over its configured byte cap', async () => {
    // Given a request whose text and wrapper exceed a small complete-body limit.
    const body = Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(100) }] }))

    // When inspected against the explicit request bound.
    const result = await inspectPaperTaskImageRequest('openai-completions', body, { limits: {
      maxBodyBytes: 32,
      maxImages: 4,
      maxImageBytes: 8 * 1024 * 1024,
      maxRawImageBytes: 16 * 1024 * 1024,
      maxBase64ImageBytes: 22 * 1024 * 1024,
      maxPixels: 1_500_000,
      maxDimension: 8192,
    } })

    // Then text, tools, history, and images share the body cap.
    expect(result).toMatchObject({ kind: 'blocked', reason: 'request-too-large' })
  })
})
