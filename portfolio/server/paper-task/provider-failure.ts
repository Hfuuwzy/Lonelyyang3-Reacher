import { Buffer } from 'node:buffer'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'

const MAX_ERROR_BYTES = 4096
const GENERIC_FAILURE = 'provider request failed'
const errorBodySchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]),
}).passthrough()

function classifyProviderFailure(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    if (error instanceof SyntaxError) return GENERIC_FAILURE
    throw error
  }
  const result = errorBodySchema.safeParse(parsed)
  if (!result.success) return GENERIC_FAILURE
  const text = typeof result.data.error === 'string' ? result.data.error : result.data.error.message
  if (/(?:api[ _-]*key|token).{0,40}(?:expired|已过期|过期)|(?:expired|已过期|过期).{0,40}(?:api[ _-]*key|token)/iu.test(text)) {
    return 'provider API key expired; update the configured provider key'
  }
  return GENERIC_FAILURE
}

export function readProviderFailure(response: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (complete: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const message = complete ? classifyProviderFailure(Buffer.concat(chunks, size).toString('utf8')) : GENERIC_FAILURE
      response.destroy()
      resolve(message)
    }
    const timer = setTimeout(() => finish(false), 2000)
    response.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_ERROR_BYTES) finish(false)
      else chunks.push(chunk)
    })
    response.once('end', () => finish(true))
    response.once('aborted', () => finish(false))
    response.once('error', () => finish(false))
  })
}
