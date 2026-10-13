import { z } from 'zod'

export const PAPER_TASK_ORIGIN_HEADER = 'x-paper-task-origin'

export const PAPER_TASK_PROVIDER_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

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
  apiKey: z.string().max(4096).default(''),
}).strict()

export type PaperTaskProviderSettings = z.infer<typeof paperTaskProviderSettingsSchema>

export const paperTaskProviderPublicStatusSchema = z.object({
  configured: z.boolean(),
  providerLabel: z.string().optional(),
  baseUrl: z.string().optional(),
  protocol: z.enum(PAPER_TASK_PROVIDER_PROTOCOLS).optional(),
  model: z.string().optional(),
  apiKeyConfigured: z.boolean(),
}).strict()

export type PaperTaskProviderPublicStatus = z.infer<typeof paperTaskProviderPublicStatusSchema>
