import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  paperTaskTranslationViewSchema,
  type PaperTaskTranslationView,
} from '../../app/utils/paper-task-translation-contract'
import { translationBlockers } from './translation-eligibility.mjs'
import { workspacePaths } from './workspace'
import { documentAssets, readDocumentArtifact } from './document-artifact.mjs'

/**
 * Reads the retained translation master for reader preview.
 *
 * A retained master is readable only when its bytes match its ledger and its
 * source-linked manuscript passes the shared publication eligibility policy.
 */
export function readPaperTaskTranslation(taskId: string, root: string): PaperTaskTranslationView | undefined {
  const document = readDocumentArtifact(root, 'translation')
  if (document.kind === 'invalid') return undefined
  if (document.kind === 'document') {
    const view = paperTaskTranslationViewSchema.safeParse({
      taskId, markdown: document.markdown,
      status: document.stale ? 'needs-update' : document.metadata.limitations.length > 0 || document.source.metadata.sourceStatus !== 'complete' ? 'incomplete' : 'complete',
      assets: documentAssets(document), unresolved: [], staleParagraphs: document.stale ? [0] : [],
    })
    return view.success ? view.data : undefined
  }
  try {
    const directory = workspacePaths(root).branchDirectories.translation
    const markdown = readFileSync(join(directory, 'master.md'), 'utf8')
    const metadata = translationMetadataSchema.safeParse(JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8')))
    if (!metadata.success) return undefined
    if (createHash('sha256').update(markdown).digest('hex') !== metadata.data.masterSha256) return undefined
    if (metadata.data.segments.map((segment) => segment.markdown).join('\n\n') !== markdown) return undefined
    const source = readTranslationSource(root)
    if (source === undefined) return undefined
    if (translationBlockers({
      records: source.records,
      segments: metadata.data.segments,
      unresolved: metadata.data.unresolved,
      markdown,
      sourceStatus: source.status,
      translationStatus: metadata.data.status,
    }).length > 0) return undefined
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
    markdown: z.string().min(1),
    stale: z.boolean(),
    dependencies: z.array(z.object({ recordId: z.string().regex(/^p\d+-r\d+$/u) })),
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

function readTranslationSource(root: string): {
  readonly records: readonly { readonly record: { readonly id: string; readonly kind: string; readonly state: string; readonly text: string } }[]
  readonly status: string
} | undefined {
  const paths = workspacePaths(root)
  const index = z.array(z.string().regex(/^p\d+-r\d+$/u)).safeParse(JSON.parse(readFileSync(join(root, 'source-index.json'), 'utf8')))
  const state = z.object({ status: z.string() }).passthrough().safeParse(JSON.parse(readFileSync(paths.sourceStatePath, 'utf8')))
  if (!index.success || !state.success) return undefined
  const records = index.data.map((id) => storedSourceSchema.safeParse(JSON.parse(readFileSync(join(paths.sourceRecordsDir, `${id}.json`), 'utf8'))))
  if (records.some((entry) => !entry.success)) return undefined
  const parsedRecords = records.flatMap((entry) => entry.success ? [entry.data] : [])
  return { records: parsedRecords, status: state.data.status }
}

const storedSourceSchema = z.object({
  record: z.object({ id: z.string(), kind: z.string(), state: z.string(), text: z.string() }).passthrough(),
}).passthrough()
