import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  paperTaskReadingViewSchema,
  type PaperTaskReadingView,
} from '../../app/utils/paper-task-reading-contract'
import type { StoredSource } from './source-store'
import { workspacePaths } from './workspace'
import { documentAssets, readDocumentArtifact } from './document-artifact.mjs'

const VISUAL_KINDS = new Set(['figure', 'table', 'formula', 'algorithm'])

const evidenceSchema = z.object({
  manuscriptSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.enum(['preview', 'needs-confirmation']),
}).passthrough()

/**
 * Reads the retained deep-reading report for the C focused reader.
 *
 * The report is accepted only when its bytes match `evidence.json` and its
 * retained preview mirror. Only task-owned original assets actually referenced
 * by the report are exposed; source records and evidence locations stay on the
 * server.
 */
export function readPaperTaskReading(
  taskId: string,
  root: string,
  stored: StoredSource,
): PaperTaskReadingView | undefined {
  const document = readDocumentArtifact(root, 'deep-reading')
  if (document.kind === 'invalid') return undefined
  if (document.kind === 'document') {
    const view = paperTaskReadingViewSchema.safeParse({
      taskId, markdown: document.markdown, assets: documentAssets(document),
      status: document.stale || document.metadata.limitations.length > 0 || document.source.metadata.sourceStatus !== 'complete' ? 'needs-confirmation' : 'preview',
    })
    return view.success ? view.data : undefined
  }
  try {
    const directory = workspacePaths(root).branchDirectories['deep-reading']
    const markdown = readFileSync(join(directory, 'report.md'), 'utf8')
    const preview = readFileSync(join(directory, 'preview.md'), 'utf8')
    const evidence = evidenceSchema.safeParse(JSON.parse(readFileSync(join(directory, 'evidence.json'), 'utf8')))
    if (!evidence.success || preview !== markdown) return undefined
    if (createHash('sha256').update(markdown).digest('hex') !== evidence.data.manuscriptSha256) return undefined

    const records = new Map(stored.source.records.map((record) => [record.id, record]))
    const assets = [...referencedAssetIds(markdown)].flatMap((id) => {
      const asset = stored.assets.find((candidate) => candidate.id === id)
      if (asset === undefined) return []
      const record = records.get(asset.recordId)
      if (record === undefined || !VISUAL_KINDS.has(record.kind)) return []
      return [{
        id,
        kind: record.kind as 'figure' | 'table' | 'formula' | 'algorithm',
        caption: captionFor(record.text, record.kind),
        availability: asset.availability === 'available' ? 'available' as const : 'missing' as const,
      }]
    })

    const view = {
      taskId,
      status: evidence.data.status,
      markdown,
      assets,
    }
    const parsed = paperTaskReadingViewSchema.safeParse(view)
    return parsed.success ? parsed.data : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function captionFor(text: string, kind: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? ''
  return (firstLine === '' ? `原文${kind}` : firstLine).slice(0, 500)
}

function referencedAssetIds(markdown: string): Set<string> {
  const found = new Set<string>()
  const prose = markdown.replace(/```[\s\S]*?```/gu, '').replace(/~~~[\s\S]*?~~~/gu, '')
  for (const match of prose.matchAll(/!\[[^\]\n]*\]\(asset:([a-z0-9-]+)\)/gu)) {
    if (match[1] !== undefined) found.add(match[1])
  }
  return found
}
