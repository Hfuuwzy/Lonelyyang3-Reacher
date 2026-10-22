import { z } from 'zod'

export const PAPER_TASK_ORIGIN_HEADER = 'x-paper-task-origin'

export const PAPER_TASK_PROVIDER_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const
export type PaperTaskProviderProtocol = (typeof PAPER_TASK_PROVIDER_PROTOCOLS)[number]

export const PAPER_TASK_PROVIDER_PROTOCOL_INFO = {
  'openai-completions': {
    label: 'OpenAI Chat Completions',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    endpointPath: '/chat/completions',
    guidance: '兼容性通常较广，适合大多数 OpenAI 兼容服务。',
  },
  'openai-responses': {
    label: 'OpenAI Responses',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    endpointPath: '/responses',
    guidance: '仅在服务明确支持 Responses API 时使用。OpenAI 推荐新项目使用；不少第三方兼容服务仍只支持 Chat Completions。',
  },
  'anthropic-messages': {
    label: 'Anthropic Messages',
    baseUrlPlaceholder: 'https://api.anthropic.com',
    endpointPath: '/v1/messages',
    guidance: 'Base URL 使用 Anthropic API 根地址，不要附加 /v1；适用于 Anthropic Messages API 或兼容网关。',
  },
} as const satisfies Record<PaperTaskProviderProtocol, {
  readonly label: string
  readonly baseUrlPlaceholder: string
  readonly endpointPath: string
  readonly guidance: string
}>

export const paperTaskProviderSettingsSchema = z.object({
  providerLabel: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(1).max(512).url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
  }),
  protocol: z.enum(PAPER_TASK_PROVIDER_PROTOCOLS),
  model: z.string().trim().min(1).max(128),
  imageInput: z.boolean().default(false),
  apiKey: z.string().max(4096).default(''),
}).strict()

export type PaperTaskProviderSettings = z.infer<typeof paperTaskProviderSettingsSchema>

export const paperTaskProviderPublicStatusSchema = z.object({
  configured: z.boolean(),
  providerLabel: z.string().optional(),
  baseUrl: z.string().optional(),
  protocol: z.enum(PAPER_TASK_PROVIDER_PROTOCOLS).optional(),
  model: z.string().optional(),
  imageInput: z.boolean(),
  apiKeyConfigured: z.boolean(),
}).strict()

export type PaperTaskProviderPublicStatus = z.infer<typeof paperTaskProviderPublicStatusSchema>
