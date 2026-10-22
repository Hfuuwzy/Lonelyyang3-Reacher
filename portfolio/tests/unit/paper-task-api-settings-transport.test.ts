import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAPER_TASK_ORIGIN_HEADER } from '../../app/utils/paper-task-provider-contract'
import {
  createPaperTaskApiSettingsTransport,
  type PaperTaskApiSettingsRequest,
} from '../../app/composables/paper-task-api-settings-transport'

const ORIGIN = 'http://localhost:3000'
const SETTINGS = {
  providerLabel: 'Local provider',
  baseUrl: 'https://api.example.test/v1',
  protocol: 'openai-completions',
  model: 'model-a',
  apiKey: 'transient-key',
} as const

afterEach(() => vi.unstubAllGlobals())

describe('paper-task API settings transport', () => {
  it('sends same-origin requests with settings only as the PUT body', async () => {
    // Given a page origin and the real settings transport with a boundary recorder.
    vi.stubGlobal('window', { location: { origin: ORIGIN } })
    const requests: Array<{ readonly url: string; readonly options: PaperTaskApiSettingsRequest }> = []
    const transport = createPaperTaskApiSettingsTransport(async (url, options) => {
      requests.push({ url, options })
      return { ok: true, body: { configured: false, apiKeyConfigured: false } }
    })
    const signal = new AbortController().signal

    // When each supported settings operation is sent.
    await transport.get(signal)
    await transport.put(SETTINGS, signal)
    await transport.delete(signal)

    // Then every method carries the current origin via the custom request header, omits cookies and the forbidden Origin header, and only PUT carries settings.
    expect(requests.map(({ url, options }) => ({
      url,
      method: options.method,
      origin: options.headers[PAPER_TASK_ORIGIN_HEADER],
      hasForbiddenOriginHeader: 'Origin' in options.headers,
      credentials: options.credentials,
      body: options.body,
    }))).toEqual([
      {
        url: '/api/prototype/paper-task-settings',
        method: 'GET',
        origin: ORIGIN,
        hasForbiddenOriginHeader: false,
        credentials: 'omit',
        body: undefined,
      },
      {
        url: '/api/prototype/paper-task-settings',
        method: 'PUT',
        origin: ORIGIN,
        hasForbiddenOriginHeader: false,
        credentials: 'omit',
        body: SETTINGS,
      },
      {
        url: '/api/prototype/paper-task-settings',
        method: 'DELETE',
        origin: ORIGIN,
        hasForbiddenOriginHeader: false,
        credentials: 'omit',
        body: undefined,
      },
    ])
  })
})
