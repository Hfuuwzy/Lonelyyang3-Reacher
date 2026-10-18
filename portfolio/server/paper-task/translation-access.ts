import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  paperTaskTranslationViewSchema,
  type PaperTaskTranslationView,
} from '../../app/utils/paper-task-translation-contract'
import { workspacePaths } from './workspace'

/**
 * Reads the retained translation master for reader preview.
 *
 * The publication is accepted only when the master bytes match the ledger hash
 * written with it. A mismatch or missing ledger means the master is not a
 * coherent publication and must not be shown as if it were.
 */
export function readPaperTaskTranslation(taskId: string, root: string): PaperTaskTranslationView | undefined {
  try {
    const directory = workspacePaths(root).branchDirectories.translation
    const markdown = readFileSync(join(directory, 'master.md'), 'utf8')
    const metadata = translationMetadataSchema.safeParse(JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8')))
    if (!metadata.success) return undefined
    if (createHash('sha256').update(markdown).digest('hex') !== metadata.data.masterSha256) return undefined
    const staleParagraphs = metadata.data.segments.filter((segment) => segment.stale).map((segment) => segment.index)
    const view = {
      taskId,
      status: staleParagraphs.length > 0 ? 'needs-update' as const : metadata.data.status,
      markdown,
      assets: metadata.data.assets.map(({ id, kind, caption, availability }) => ({ id, kind, caption, availability })),
      unresolved: metadata.data.unresolved,
      staleParagraphs,
    }
    const parsed = paperTaskTranslationViewSchema.safeParse(view)
    return parsed.success ? parsed.data : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

const translationMetadataSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'needs-update']),
  masterSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  segments: z.array(z.object({
    index: z.number().int().nonnegative(),
    stale: z.boolean(),
  }).passthrough()).min(1),
  assets: z.array(z.object({
    id: z.string().regex(/^asset-[0-9a-z]+$/u),
    recordId: z.string().regex(/^p\d+-r\d+$/u),
    kind: z.enum(['figure', 'table', 'formula', 'algorithm']),
    caption: z.string().min(1).max(500),
    availability: z.enum(['available', 'missing']),
  }).strict()).max(500),
  unresolved: z.array(z.object({
    recordId: z.string().regex(/^p\d+-r\d+$/u),
    reason: z.string().min(1).max(500),
  }).strict()).max(500),
}).passthrough()
