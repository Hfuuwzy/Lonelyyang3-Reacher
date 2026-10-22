import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PaperTaskBranchQualityState } from './format-gate'
import { readDocumentArtifact } from './document-artifact.mjs'
import { readPaperTaskArtifact, readPaperTaskFormatStatus } from './artifact-export'
import { workspacePaths } from './workspace'

export const PAPER_TASK_PDF_FORMAT_NAME = 'pdf-format.json'
export const PAPER_TASK_TRANSLATED_PDF_NAME = 'translated.pdf'

const MAX_PDF_BYTES = 100 * 1024 * 1024

const artifactMasterHash = z.string().regex(/^[0-9a-f]{64}$/u)

const translationLedgerSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'needs-update']),
  masterSha256: artifactMasterHash,
}).passthrough()

/** Reads the retained original upload; the reader never substitutes it for a translation. */
export function readPaperTaskOriginalPdf(root: string): Uint8Array | undefined {
  try {
    return readPdf(workspacePaths(root).originalPath)
  } catch {
    return undefined
  }
}

/**
 * Reads the translated PDF only when it is a qualified artifact:
 * the branch quality is complete, the artifact metadata matches the approved
 * master hash, and every required page check passed (or is minor). Any missing
 * metadata, build, or page evidence keeps the final entry unavailable.
 */
export function readPaperTaskTranslatedPdf(
  root: string,
  masterQuality: PaperTaskBranchQualityState,
): Uint8Array | undefined {
  try {
    const directory = workspacePaths(root).branchDirectories.translation
    const document = readDocumentArtifact(root, 'translation')
    if (document.kind === 'invalid') return undefined
    let markdown: string
    if (document.kind === 'document') {
      if (document.stale) return undefined
      markdown = document.markdown
    } else {
      const master = readFileSync(join(directory, 'master.md'))
      const preview = readFileSync(join(directory, 'preview.md'))
      const ledger = translationLedgerSchema.safeParse(JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8')))
      if (!ledger.success || ledger.data.status !== 'complete' || !master.equals(preview)) return undefined
      const masterSha256 = createHash('sha256').update(master).digest('hex')
      if (ledger.data.masterSha256 !== masterSha256) return undefined
      markdown = master.toString('utf8')
    }
    const status = readPaperTaskFormatStatus(root, 'translation', 'pdf', markdown, masterQuality)
    if (!status.finalAvailable) return undefined
    const bytes = readPaperTaskArtifact({ root, branch: 'translation', format: 'pdf', markdown, masterQuality })
    if (bytes === undefined || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return undefined
    return new Uint8Array(bytes)
  } catch {
    return undefined
  }
}

function readPdf(path: string): Uint8Array | undefined {
  const bytes = readFileSync(path)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) return undefined
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return undefined
  return new Uint8Array(bytes)
}
