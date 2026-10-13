import { describe, expect, it } from 'vitest'
import {
  usePaperTaskApiSettings,
  type PaperTaskApiSettingsLifecycleCallbacks,
} from '../../app/composables/paper-task-api-settings'
import type { PaperTaskApiSettingsTransport } from '../../app/composables/paper-task-api-settings-transport'
import type {
  PaperTaskProviderPublicStatus,
  PaperTaskProviderSettings,
} from '../../app/utils/paper-task-provider-contract'

const EMPTY_STATUS = { configured: false, apiKeyConfigured: false } as const satisfies PaperTaskProviderPublicStatus

const CONFIGURED_STATUS = {
  configured: true,
  providerLabel: 'Local provider',
  baseUrl: 'https://api.example.test/v1',
  protocol: 'openai-completions',
  model: 'model-a',
  apiKeyConfigured: true,
} as const satisfies PaperTaskProviderPublicStatus

function createHarness(
  initialStatus: PaperTaskProviderPublicStatus = EMPTY_STATUS,
  readError: Error | null = null,
  initialReadBody: unknown = initialStatus,
) {
  let activeStatus: PaperTaskProviderPublicStatus = initialStatus
  let readCount = 0
  let clearCount = 0
  const appliedSettings: PaperTaskProviderSettings[] = []
  let lifecycle: PaperTaskApiSettingsLifecycleCallbacks | undefined

  const transport: PaperTaskApiSettingsTransport = {
    async get() {
      readCount += 1
      if (readError !== null) throw readError
      return { ok: true, body: readCount === 1 ? initialReadBody : activeStatus }
    },
    async put(settings) {
      appliedSettings.push({ ...settings })
      activeStatus = {
        configured: true,
        providerLabel: settings.providerLabel,
        baseUrl: settings.baseUrl,
        protocol: settings.protocol,
        model: settings.model,
        apiKeyConfigured: settings.apiKey.length > 0,
      }
      return { ok: true, body: { configured: true, apiKeyConfigured: activeStatus.apiKeyConfigured } }
    },
    async delete() {
      clearCount += 1
      activeStatus = EMPTY_STATUS
      return { ok: true, body: EMPTY_STATUS }
    },
  }

  const settings = usePaperTaskApiSettings({
    transport,
    registerLifecycle(callbacks) {
      lifecycle = callbacks
    },
  })

  return {
    settings,
    appliedSettings,
    get readCount() {
      return readCount
    },
    get clearCount() {
      return clearCount
    },
    async mount() {
      if (lifecycle === undefined) throw new Error('Settings lifecycle was not registered.')
      await lifecycle.mounted()
    },
    pageHide() {
      if (lifecycle === undefined) throw new Error('Settings lifecycle was not registered.')
      lifecycle.pageHide()
    },
    dispose() {
      if (lifecycle === undefined) throw new Error('Settings lifecycle was not registered.')
      lifecycle.dispose()
    },
  }
}

describe('paper-task API settings', () => {
  it('loads only after mount and exposes the validated safe status', async () => {
    // Given a configured server status and a client lifecycle boundary.
    const harness = createHarness(CONFIGURED_STATUS)
    expect(harness.readCount).toBe(0)

    // When the page mounts.
    await harness.mount()

    // Then only public settings are shown and the password field stays empty.
    expect(harness.readCount).toBe(1)
    expect(harness.settings.phase.value).toBe('ready')
    expect(harness.settings.status.value).toEqual(CONFIGURED_STATUS)
    expect(harness.settings.form.apiKey).toBe('')
  })

  it('rejects configured status that omits required provider fields', async () => {
    // Given a configured response without the fields required for safe display.
    const harness = createHarness(EMPTY_STATUS, null, { configured: true, apiKeyConfigured: false })

    // When the page loads settings.
    await harness.mount()

    // Then the incomplete response cannot become the displayed configuration.
    expect(harness.settings.phase.value).toBe('error')
    expect(harness.settings.status.value).toBeNull()
    expect(harness.settings.notice.value).toBe('load-failed')
  })

  it('applies normalized settings and clears the submitted key from the form', async () => {
    // Given a ready form containing a local provider and its credential.
    const harness = createHarness()
    await harness.mount()
    harness.settings.form.providerLabel = '  Local provider  '
    harness.settings.form.baseUrl = 'https://api.example.test/v1'
    harness.settings.form.protocol = 'openai-responses'
    harness.settings.form.model = '  model-b  '
    harness.settings.form.apiKey = 'transient-key'

    // When settings are applied.
    const applying = harness.settings.handleApply()
    expect(harness.settings.form.apiKey).toBe('')
    await applying

    // Then the settings endpoint receives the parsed values and the UI retains no key.
    expect(harness.appliedSettings).toEqual([{
      providerLabel: 'Local provider',
      baseUrl: 'https://api.example.test/v1',
      protocol: 'openai-responses',
      model: 'model-b',
      apiKey: 'transient-key',
    }])
    expect(harness.settings.form.apiKey).toBe('')
    expect(harness.settings.status.value?.model).toBe('model-b')
    expect(harness.settings.status.value?.apiKeyConfigured).toBe(true)
    expect(harness.readCount).toBe(2)
  })

  it('accepts a keyless provider configuration', async () => {
    // Given a ready form for a provider that does not require an API key.
    const harness = createHarness()
    await harness.mount()
    harness.settings.form.providerLabel = 'Public endpoint'
    harness.settings.form.baseUrl = 'https://api.example.test/v1'
    harness.settings.form.protocol = 'anthropic-messages'
    harness.settings.form.model = 'public-model'

    // When the empty-key configuration is applied.
    await harness.settings.handleApply()

    // Then the empty key is accepted and the public status reports no configured key.
    expect(harness.appliedSettings[0]?.apiKey).toBe('')
    expect(harness.settings.status.value?.configured).toBe(true)
    expect(harness.settings.status.value?.apiKeyConfigured).toBe(false)
  })

  it('clears server settings and the editable values', async () => {
    // Given a configured provider loaded from the server.
    const harness = createHarness(CONFIGURED_STATUS)
    await harness.mount()

    // When the user clears settings.
    await harness.settings.handleClear()

    // Then the clear endpoint ran and the UI reflects an unconfigured state.
    expect(harness.clearCount).toBe(1)
    expect(harness.settings.status.value).toEqual(EMPTY_STATUS)
    expect(harness.settings.form.providerLabel).toBe('')
    expect(harness.settings.form.apiKey).toBe('')
  })

  it('uses a fixed error state when the status request fails', async () => {
    // Given a server error that includes untrusted diagnostic text.
    const harness = createHarness(EMPTY_STATUS, new Error('request body contained a key'))

    // When the page loads settings.
    await harness.mount()

    // Then the interface exposes only the fixed failure state.
    expect(harness.settings.phase.value).toBe('error')
    expect(harness.settings.notice.value).toBe('load-failed')
  })

  it('clears the password field when the page is hidden', () => {
    // Given a key typed into the page-local field.
    const harness = createHarness()
    harness.settings.form.apiKey = 'transient-key'

    // When the pagehide lifecycle fires.
    harness.pageHide()

    // Then the field no longer contains the credential.
    expect(harness.settings.form.apiKey).toBe('')
  })

  it('clears the password field when the component is disposed', () => {
    // Given a key typed into the page-local field.
    const harness = createHarness()
    harness.settings.form.apiKey = 'transient-key'

    // When the component is disposed.
    harness.dispose()

    // Then the field no longer contains the credential.
    expect(harness.settings.form.apiKey).toBe('')
  })
})
