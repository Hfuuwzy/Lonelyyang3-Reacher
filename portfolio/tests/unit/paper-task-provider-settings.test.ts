import { afterEach, describe, expect, it } from 'vitest'
import { paperTaskProviderSettingsSchema } from '../../app/utils/paper-task-provider-contract'
import {
  clearPaperTaskProviderSettings,
  getPaperTaskProviderSettings,
  hasExactPaperTaskProviderSettingsOrigin,
  replacePaperTaskProviderSettings,
} from '../../server/paper-task/provider-settings'

const validSettings = {
  providerLabel: 'Local provider',
  baseUrl: 'https://api.example.test/v1',
  protocol: 'openai-completions',
  model: 'model-a',
  apiKey: 'secret-value',
} as const
afterEach(clearPaperTaskProviderSettings)

describe('paper-task provider settings', () => {
  it('parses bounded configurations and rejects URL credentials', () => {
    expect(paperTaskProviderSettingsSchema.safeParse(validSettings).success).toBe(true)
    expect(paperTaskProviderSettingsSchema.safeParse({ ...validSettings, baseUrl: 'https://user:pass@example.test' }).success).toBe(false)
    expect(paperTaskProviderSettingsSchema.safeParse({ ...validSettings, protocol: 'unknown' }).success).toBe(false)
  })

  it('returns a private snapshot that survives replacing and clearing the active value', () => {
    replacePaperTaskProviderSettings(validSettings)
    const activeSnapshot = getPaperTaskProviderSettings()
    replacePaperTaskProviderSettings({ ...validSettings, model: 'model-b' })
    clearPaperTaskProviderSettings()
    expect(activeSnapshot?.model).toBe('model-a')
    expect(getPaperTaskProviderSettings()).toBeUndefined()
  })

  it('accepts only a full exact HTTP or HTTPS request Origin', () => {
    expect(hasExactPaperTaskProviderSettingsOrigin('http://localhost:3000', 'localhost:3000')).toBe(true)
    expect(hasExactPaperTaskProviderSettingsOrigin(undefined, 'localhost:3000')).toBe(false)
    expect(hasExactPaperTaskProviderSettingsOrigin('http://localhost:3001', 'localhost:3000')).toBe(false)
  })
})
