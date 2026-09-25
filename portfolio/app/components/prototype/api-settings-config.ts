/**
 * Shared API-settings configuration for the prototype.
 *
 * The provider endpoints and models in {@link GATEWAY_GUIDE_SETUP} are copied
 * verbatim from the supplied gateway guide (key.goaichat.top/guide/). They are
 * examples specific to that guide's conventions — inferring `/v1` placement or
 * model lists from them for any other provider would be a mistake. They are
 * not universal endpoints.
 */

export const API_PROTOCOLS = {
  openaiCompletions: 'openai-completions',
  anthropicMessages: 'anthropic-messages',
} as const

export type ApiProtocol = (typeof API_PROTOCOLS)[keyof typeof API_PROTOCOLS]

export const GATEWAY_GUIDE_SETUP = {
  source: 'goaichat-gateway-guide',
  openaiCompatible: {
    baseUrl: 'https://llm.goaichat.top/v1',
    protocol: API_PROTOCOLS.openaiCompletions,
    models: ['qwen3.8-max', 'kimi-k3'],
  },
  anthropicCompatible: {
    baseUrl: 'https://llm.goaichat.top',
    protocol: API_PROTOCOLS.anthropicMessages,
    models: ['glm-5.2'],
  },
} as const