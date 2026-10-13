import { Buffer } from 'node:buffer'
import { createError, defineEventHandler, getRequestHeader, setResponseHeader, type EventHandler } from 'h3'
import { paperTaskProviderSettingsSchema } from '../../app/utils/paper-task-provider-contract'
import {
  clearPaperTaskProviderSettings,
  getPaperTaskProviderSettings,
  replacePaperTaskProviderSettings,
  requirePaperTaskProviderSettingsAccess,
} from './provider-settings'
import { checkContentLength } from '../utils/paper-review/gate'

const MAX_SETTINGS_BODY_BYTES = 8 * 1024

class SettingsBodyTooLargeError extends Error {}

async function readSettingsBody(event: Parameters<EventHandler>[0]): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of event.node.req) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : undefined
    if (bytes === undefined) throw createError({ statusCode: 400, message: '设置请求不是有效的 JSON 数据。' })
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_SETTINGS_BODY_BYTES) {
      throw new SettingsBodyTooLargeError()
    }
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'))
  } catch (error) {
    if (error instanceof Error) throw createError({ statusCode: 400, message: '设置请求不是有效的 JSON 数据。' })
    throw error
  }
}

export function createPaperTaskProviderSettingsHandlers(dev: boolean): {
  readonly get: EventHandler
  readonly put: EventHandler
  readonly delete: EventHandler
} {
  const get = defineEventHandler((event) => {
    requirePaperTaskProviderSettingsAccess(event, dev)
    setResponseHeader(event, 'cache-control', 'no-store')
    const settings = getPaperTaskProviderSettings()
    if (settings === undefined) return { configured: false, apiKeyConfigured: false }
    return {
      configured: true,
      providerLabel: settings.providerLabel,
      baseUrl: settings.baseUrl,
      protocol: settings.protocol,
      model: settings.model,
      apiKeyConfigured: settings.apiKey.length > 0,
    }
  })

  const put = defineEventHandler(async (event) => {
    requirePaperTaskProviderSettingsAccess(event, dev)
    setResponseHeader(event, 'cache-control', 'no-store')
    const size = checkContentLength(getRequestHeader(event, 'content-length'), MAX_SETTINGS_BODY_BYTES)
    if (!size.ok) throw createError({ statusCode: size.statusCode, message: '设置请求大小无效。' })
    let payload: unknown
    try {
      payload = await readSettingsBody(event)
    } catch (error) {
      if (error instanceof SettingsBodyTooLargeError) {
        throw createError({ statusCode: 413, message: '设置请求超过大小上限。' })
      }
      if (error instanceof Error) throw createError({ statusCode: 400, message: '设置请求无法读取。' })
      throw error
    }
    const settings = paperTaskProviderSettingsSchema.safeParse(payload)
    if (!settings.success) throw createError({ statusCode: 400, message: '提供方设置字段无效。' })
    replacePaperTaskProviderSettings(settings.data)
    return { configured: true, apiKeyConfigured: settings.data.apiKey.length > 0 }
  })

  const remove = defineEventHandler((event) => {
    requirePaperTaskProviderSettingsAccess(event, dev)
    setResponseHeader(event, 'cache-control', 'no-store')
    clearPaperTaskProviderSettings()
    return { configured: false, apiKeyConfigured: false }
  })

  return { get, put, delete: remove }
}
