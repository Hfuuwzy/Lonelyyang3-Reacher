import { z } from 'zod'
import { PAPER_TASK_BRANCHES } from './paper-task-contract'

export const IMAGE_LIMITS = {
  maxPixels: 1_500_000,
  maxDimension: 8192,
  maxImageBytes: 8 * 1024 * 1024,
  maxImages: 4,
  maxRawImageBytes: 16 * 1024 * 1024,
  maxBase64ImageBytes: 22 * 1024 * 1024,
  maxBodyBytes: 24 * 1024 * 1024,
  maxContextBytes: 20_000,
} as const

export const PAPER_TASK_IMAGE_REASONS = [
  'not-enabled', 'missing', 'unreadable', 'invalid-image', 'image-too-large',
  'image-too-many-pixels', 'image-dimension-too-large', 'too-many-images',
  'aggregate-image-too-large', 'context-too-large', 'unsupported-protocol',
  'request-too-large', 'unexpected-image', 'changed-image', 'missing-image',
  'provider-failed', 'cancelled', 'unwired', 'stale-source',
] as const

export const paperTaskImageReceiptSchema = z.object({
  branch: z.enum(PAPER_TASK_BRANCHES),
  assetId: z.string().regex(/^asset-[0-9a-f]{32}$/),
  recordId: z.string().regex(/^p\d+-r\d+$/),
  revision: z.number().int().positive(),
  status: z.enum(['not-sent', 'blocked', 'transported', 'interrupted']),
  reason: z.enum(PAPER_TASK_IMAGE_REASONS).nullable(),
}).strict().readonly()

export type PaperTaskImageBranch = z.infer<typeof paperTaskImageReceiptSchema>['branch']
export type PaperTaskImageReason = (typeof PAPER_TASK_IMAGE_REASONS)[number]
export type PaperTaskImageReceipt = z.infer<typeof paperTaskImageReceiptSchema>
