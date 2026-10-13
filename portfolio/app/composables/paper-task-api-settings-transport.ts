import { $fetch } from 'ofetch'
import { PAPER_TASK_ORIGIN_HEADER, type PaperTaskProviderSettings } from '../utils/paper-task-provider-contract'

const SETTINGS_ENDPOINT = '/api/prototype/paper-task-settings'
const SETTINGS_TIMEOUT_MS = 5_000

export interface PaperTaskApiSettingsResponse {
  readonly ok: boolean
  readonly body: unknown
}

export interface PaperTaskApiSettingsTransport {
  readonly get: (signal: AbortSignal) => Promise<PaperTaskApiSettingsResponse>
  readonly put: (
    settings: PaperTaskProviderSettings,
    signal: AbortSignal,
  ) => Promise<PaperTaskApiSettingsResponse>
  readonly delete: (signal: AbortSignal) => Promise<PaperTaskApiSettingsResponse>
}

export interface PaperTaskApiSettingsRequest {
  readonly method: 'GET' | 'PUT' | 'DELETE'
  readonly headers: { readonly [PAPER_TASK_ORIGIN_HEADER]: string }
  readonly credentials: 'omit'
  readonly cache: 'no-store'
  readonly retry: 0
  readonly timeout: number
  readonly ignoreResponseError: true
  readonly signal: AbortSignal
  readonly body?: PaperTaskProviderSettings
}

export type PaperTaskApiSettingsRequester = (
  url: string,
  options: PaperTaskApiSettingsRequest,
) => Promise<PaperTaskApiSettingsResponse>

async function requestSettings(
  url: string,
  options: PaperTaskApiSettingsRequest,
): Promise<PaperTaskApiSettingsResponse> {
  const response = await $fetch.raw<unknown>(url, options)
  return { ok: response.ok, body: response._data }
}

export function createPaperTaskApiSettingsTransport(
  request: PaperTaskApiSettingsRequester = requestSettings,
): PaperTaskApiSettingsTransport {
  async function send(
    method: PaperTaskApiSettingsRequest['method'],
    signal: AbortSignal,
    body?: PaperTaskProviderSettings,
  ): Promise<PaperTaskApiSettingsResponse> {
    const options = {
      method,
      headers: { [PAPER_TASK_ORIGIN_HEADER]: window.location.origin },
      credentials: 'omit',
      cache: 'no-store',
      retry: 0,
      timeout: SETTINGS_TIMEOUT_MS,
      ignoreResponseError: true,
      signal,
      ...(body === undefined ? {} : { body }),
    } satisfies PaperTaskApiSettingsRequest
    return request(SETTINGS_ENDPOINT, options)
  }

  return {
    get: (signal) => send('GET', signal),
    put: (settings, signal) => send('PUT', signal, settings),
    delete: (signal) => send('DELETE', signal),
  }
}
