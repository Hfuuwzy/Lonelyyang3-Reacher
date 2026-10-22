import { describe, expect, it } from 'vitest'
import { API_PROTOCOLS, GATEWAY_GUIDE_SETUP } from '../../app/components/prototype/api-settings-config'

const configModule = await import('../../app/components/prototype/api-settings-config')

describe('prototype api-settings config', () => {
  it('exposes only the planned runtime API', () => {
    expect(Object.keys(configModule).sort()).toEqual(['API_PROTOCOLS', 'GATEWAY_GUIDE_SETUP'])
  })

  it('exposes exactly the two allowed protocols with no OpenAI Responses', () => {
    expect(Object.values(API_PROTOCOLS)).toEqual(['openai-completions', 'anthropic-messages'])
    expect(Object.values(API_PROTOCOLS)).not.toContain('openai-responses')
  })

  it('defines the gateway-guide OpenAI-compatible setup example', () => {
    expect(GATEWAY_GUIDE_SETUP.openaiCompatible).toEqual({
      baseUrl: 'https://llm.goaichat.top/v1',
      protocol: 'openai-completions',
      models: ['qwen3.8-max', 'kimi-k3'],
    })
  })

  it('defines the gateway-guide Anthropic-compatible setup example', () => {
    expect(GATEWAY_GUIDE_SETUP.anthropicCompatible).toEqual({
      baseUrl: 'https://llm.goaichat.top',
      protocol: 'anthropic-messages',
      models: ['glm-5.2'],
    })
  })

  it('marks the setup examples as specific to the supplied gateway guide', () => {
    expect(GATEWAY_GUIDE_SETUP.source).toBe('goaichat-gateway-guide')
  })
})
