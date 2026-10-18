import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { evaluateFormatGate, type PaperTaskBranchQualityState } from './format-gate'
import { workspacePaths } from './workspace'

export const PAPER_TASK_PDF_FORMAT_NAME = 'pdf-format.json'
export const PAPER_TASK_TRANSLATED_PDF_NAME = 'translated.pdf'

const MAX_PDF_BYTES = 100 * 1024 * 1024

const artifactMasterHash = z.string().regex(/^[0-9a-f]{64}$/u)

const pdfFormatSchema = z.object({
  format: z.literal('pdf'),
  build: z.enum(['unbuilt', 'built', 'failed']),
  sourceMasterSha256: artifactMasterHash.optional(),
  artifactMasterSha256: artifactMasterHash.optional(),
  expectedPageCount: z.number().int().positive().optional(),
  pages: z.array(z.object({
    page: z.number().int().positive(),
    status: z.enum(['passed', 'minor', 'blocked']),
    reason: z.string().max(500).optional(),
  }).strict()).max(5000).optional(),
  blockers: z.array(z.string().min(1).max(500)).max(100).optional(),
}).strict()

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
    const master = readFileSync(join(directory, 'master.md'))
    const preview = readFileSync(join(directory, 'preview.md'))
    const ledger = translationLedgerSchema.safeParse(JSON.parse(readFileSync(join(directory, 'translation.json'), 'utf8')))
    if (!ledger.success || ledger.data.status !== 'complete') return undefined
    if (!master.equals(preview)) return undefined
    const masterSha256 = createHash('sha256').update(master).digest('hex')
    if (ledger.data.masterSha256 !== masterSha256) return undefined

    const state = pdfFormatSchema.safeParse(JSON.parse(readFileSync(join(directory, PAPER_TASK_PDF_FORMAT_NAME), 'utf8')))
    if (!state.success) return undefined
    const gate = evaluateFormatGate({ ...state.data, masterQuality })
    if (gate.status !== 'complete') return undefined
    if (state.data.sourceMasterSha256 !== masterSha256) return undefined

    return readPdf(join(directory, PAPER_TASK_TRANSLATED_PDF_NAME))
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
