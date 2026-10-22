import {
  paperTaskProviderPublicStatusSchema,
  type PaperTaskProviderPublicStatus,
} from './paper-task-provider-contract'

export function parsePaperTaskPublicStatus(body: unknown): PaperTaskProviderPublicStatus | null {
  const parsed = paperTaskProviderPublicStatusSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

export function parseCompletePaperTaskPublicStatus(body: unknown): PaperTaskProviderPublicStatus | null {
  const status = parsePaperTaskPublicStatus(body)
  if (status === null || !status.configured) {
    return status
  }
  if (
    status.providerLabel === undefined
    || status.baseUrl === undefined
    || status.protocol === undefined
    || status.model === undefined
  ) {
    return null
  }
  return status
}
