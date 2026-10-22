import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { z } from 'zod'
import type { PaperTaskBranch } from '../../app/utils/paper-task-contract'
import { PAPER_TASK_EXPORT_FORMATS, type PaperTaskExportFormat } from '../../app/utils/paper-task-reader-contract'
import { evaluateFormatGate, type PaperTaskBranchQualityState, type PaperTaskFormat, type PaperTaskFormatPageCheck, type PaperTaskFormatStatus } from './format-gate'
import { renderPaperTaskPdf, type PaperTaskRenderAsset } from './document-render'
import { writeOwnedFile } from './controlled-files.mjs'

export { PAPER_TASK_EXPORT_FORMATS, type PaperTaskExportFormat }
export type PaperTaskExportBuildStatus = 'unbuilt' | 'built' | 'failed'
export type PaperTaskExportStatus = PaperTaskFormatStatus | 'unbuilt'

const digest = z.string().regex(/^[0-9a-f]{64}$/u)
const formatSchema = z.enum(PAPER_TASK_EXPORT_FORMATS)
const pageCheckSchema = z.object({
  page: z.number().int().positive(),
  status: z.enum(['passed', 'minor', 'blocked']),
  expected: z.string().min(1).max(500),
  observed: z.string().min(1).max(500),
  evidence: z.string().min(1).max(500),
  reason: z.string().max(500).optional(),
}).strict()
const boundaryCheckSchema = z.object({
  method: z.enum(['byte-identical-approved-master', 'markdown-asset-link-projection', 'ordered-normalized-text-extraction', 'referenced-asset-byte-identity']),
  passed: z.literal(true), sourceMasterSha256: digest,
  sourceBlocks: z.number().int().positive(), matchedBlocks: z.number().int().positive(),
}).strict()
const formatArtifactSchema = z.object({
  version: z.literal(1), branch: z.enum(['translation', 'deep-reading']), format: formatSchema,
  build: z.enum(['built', 'failed']), sourceMasterSha256: digest,
  artifactMasterSha256: digest.optional(), artifactSha256: digest.optional(),
  boundaryCheck: boundaryCheckSchema.optional(),
  expectedPageCount: z.number().int().positive().max(5000).optional(),
  pages: z.array(pageCheckSchema).max(5000).default([]),
  blockers: z.array(z.string().min(1).max(300)).max(100).default([]),
  failureCode: z.string().min(1).max(100).optional(),
}).strict()

export interface PaperTaskExportAsset extends PaperTaskRenderAsset {
  readonly caption?: string
}

export interface PaperTaskArtifactStatus {
  readonly branch: PaperTaskBranch
  readonly format: PaperTaskExportFormat
  readonly status: PaperTaskExportStatus
  readonly build: PaperTaskExportBuildStatus
  readonly fileName: string
  readonly available: boolean
  readonly inspectionAvailable: boolean
  readonly finalAvailable: boolean
  readonly artifactSha256?: string
  readonly expectedPageCount?: number
  readonly pages: readonly PaperTaskFormatPageCheck[]
  readonly blockers: readonly string[]
  readonly boundaryVerified: boolean
}

export interface PaperTaskFormatInspection {
  /** Identity of the exact PDF whose pages were inspected in the reader. */
  readonly artifactSha256: string
  readonly expectedPageCount: number
  readonly pages: readonly PaperTaskFormatPageCheck[]
}

export interface PaperTaskArtifactOptions {
  readonly root: string
  readonly branch: PaperTaskBranch
  readonly format: PaperTaskExportFormat
  readonly markdown: string
  readonly assets: readonly PaperTaskExportAsset[]
  readonly masterQuality: PaperTaskBranchQualityState
}

interface ArtifactPurpose extends Omit<PaperTaskArtifactOptions, 'assets'> {
  readonly purpose?: 'final' | 'inspection'
}

const FILE_DETAILS: Record<PaperTaskBranch, Record<PaperTaskExportFormat, { readonly artifact: string; readonly metadata: string; readonly fileName: string }>> = {
  translation: {
    markdown: { artifact: 'translation.md', metadata: 'markdown-format.json', fileName: 'translation.md' },
    assets: { artifact: 'translation-assets.zip', metadata: 'assets-format.json', fileName: 'translation-assets.zip' },
    pdf: { artifact: 'translated.pdf', metadata: 'pdf-format.json', fileName: 'translated.pdf' },
  },
  'deep-reading': {
    markdown: { artifact: 'deep-reading.md', metadata: 'markdown-format.json', fileName: 'deep-reading.md' },
    assets: { artifact: 'deep-reading-assets.zip', metadata: 'assets-format.json', fileName: 'deep-reading-assets.zip' },
    pdf: { artifact: 'deep-reading.pdf', metadata: 'pdf-format.json', fileName: 'deep-reading.pdf' },
  },
}

const MAX_MARKDOWN_BYTES = 400_000
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024

/** Build one requested format from one branch's current retained Markdown master. */
export async function buildPaperTaskFormat(options: PaperTaskArtifactOptions): Promise<PaperTaskArtifactStatus> {
  const { root, branch, format, markdown, assets, masterQuality } = options
  const branchRoot = join(root, 'drafts', branch)
  const details = FILE_DETAILS[branch][format]
  const sourceMasterSha256 = hash(markdown)
  const base = { version: 1 as const, branch, format, sourceMasterSha256, pages: [], blockers: [] }

  try {
    if (Buffer.byteLength(markdown, 'utf8') === 0 || Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('master-out-of-range')
    if (branch === 'deep-reading' && format === 'pdf') throw new Error('format-not-supported-for-branch')
    const built = await buildBytes(format, markdown, assets)
    if (built.boundaryCheck.sourceMasterSha256 !== sourceMasterSha256) throw new Error('master-boundary-mismatch')
    await writeOwnedFile(branchRoot, details.artifact, built.bytes)
    const artifactSha256 = hash(built.bytes)
    const metadata = formatArtifactSchema.parse({
      ...base,
      build: 'built',
      artifactMasterSha256: sourceMasterSha256,
      artifactSha256,
      boundaryCheck: built.boundaryCheck,
      ...(built.pageCount === undefined ? {} : { expectedPageCount: built.pageCount }),
      blockers: built.blockers,
    })
    await writeOwnedFile(branchRoot, details.metadata, JSON.stringify(metadata))
    return readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
  } catch (error) {
    const failureCode = error instanceof Error && error.message === 'format-not-supported-for-branch'
      ? 'format-not-supported-for-branch'
      : 'format-build-failed'
    const metadata = formatArtifactSchema.parse({ ...base, build: 'failed', failureCode })
    await writeOwnedFile(branchRoot, details.metadata, JSON.stringify(metadata))
    return readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
  }
}

/** Return a format's independent status after validating its current bytes and master identity. */
export function readPaperTaskFormatStatus(
  root: string,
  branch: PaperTaskBranch,
  format: PaperTaskExportFormat,
  markdown: string,
  masterQuality: PaperTaskBranchQualityState,
): PaperTaskArtifactStatus {
  const details = FILE_DETAILS[branch][format]
  const empty: PaperTaskArtifactStatus = {
    branch, format, status: 'unbuilt', build: 'unbuilt', fileName: details.fileName,
    available: false, inspectionAvailable: false, finalAvailable: false,
    pages: [], blockers: [], boundaryVerified: false,
  }
  const metadataPath = join(root, 'drafts', branch, details.metadata)
  if (!regularFile(metadataPath, 256_000)) return empty
  let parsed: z.infer<typeof formatArtifactSchema>
  try {
    parsed = formatArtifactSchema.parse(JSON.parse(readFileSync(metadataPath, 'utf8')))
  } catch {
    return { ...empty, status: 'failed', build: 'failed' }
  }
  if (parsed.branch !== branch || parsed.format !== format) return { ...empty, status: 'failed', build: 'failed' }
  if (parsed.build === 'failed') return { ...empty, status: 'failed', build: 'failed', blockers: [parsed.failureCode ?? 'format-build-failed'] }
  if (parsed.sourceMasterSha256 !== hash(markdown) || parsed.artifactMasterSha256 !== hash(markdown)
    || parsed.boundaryCheck?.sourceMasterSha256 !== hash(markdown) || parsed.boundaryCheck.passed !== true) {
    return { ...empty, status: 'failed', build: 'failed', blockers: ['artifact-does-not-match-current-master'] }
  }
  const artifactPath = join(root, 'drafts', branch, details.artifact)
  if (parsed.artifactSha256 === undefined || !regularFile(artifactPath, MAX_ARTIFACT_BYTES)) {
    return { ...empty, status: 'failed', build: 'failed', blockers: ['artifact-bytes-unavailable'] }
  }
  const bytes = readFileSync(artifactPath)
  if (hash(bytes) !== parsed.artifactSha256) return { ...empty, status: 'failed', build: 'failed', blockers: ['artifact-bytes-changed'] }
  const signatureValid = format === 'pdf'
    ? bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    : format === 'assets'
      ? bytes.subarray(0, 2).equals(Buffer.from('PK'))
      : true
  if (!signatureValid) return { ...empty, status: 'failed', build: 'failed', blockers: ['artifact-container-invalid'] }

  const blockers = [...parsed.blockers]
  const isPageChecked = format === 'pdf'
  const evaluation = isPageChecked
    ? evaluateFormatGate({
      format: format as PaperTaskFormat, build: 'built', masterQuality,
      sourceMasterSha256: parsed.sourceMasterSha256, artifactMasterSha256: parsed.artifactMasterSha256,
      expectedPageCount: parsed.expectedPageCount, pages: parsed.pages, blockers,
    })
    : evaluateFormatGate({ format: 'markdown', build: 'built', masterQuality,
      sourceMasterSha256: parsed.sourceMasterSha256, artifactMasterSha256: parsed.artifactMasterSha256, blockers })
  return {
    branch, format, status: evaluation.status, build: 'built', fileName: details.fileName,
    available: true,
    inspectionAvailable: isPageChecked,
    finalAvailable: evaluation.status === 'complete',
    artifactSha256: parsed.artifactSha256,
    ...(parsed.expectedPageCount === undefined ? {} : { expectedPageCount: parsed.expectedPageCount }),
    pages: parsed.pages,
    blockers: [...new Set([...blockers, ...evaluation.issues])],
    boundaryVerified: parsed.boundaryCheck?.passed === true,
  }
}

/** Retrieve only the current artifact; final PDF bytes require the full page gate. */
export function readPaperTaskArtifact(options: ArtifactPurpose): Buffer | undefined {
  const { root, branch, format, markdown, masterQuality, purpose = 'final' } = options
  const status = readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
  if (!status.available || format === 'pdf' && purpose === 'final' && !status.finalAvailable) return undefined
  const path = join(root, 'drafts', branch, FILE_DETAILS[branch][format].artifact)
  if (!regularFile(path, MAX_ARTIFACT_BYTES)) return undefined
  return readFileSync(path)
}

/** Persist one complete per-page visual inspection, bound to the actual artifact hash. */
export async function submitPaperTaskFormatInspection(options: {
  readonly root: string
  readonly branch: PaperTaskBranch
  readonly format: 'pdf'
  readonly markdown: string
  readonly masterQuality: PaperTaskBranchQualityState
  readonly inspection: PaperTaskFormatInspection
}): PaperTaskArtifactStatus {
  const { root, branch, format, markdown, masterQuality, inspection } = options
  const current = readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
  if (current.build !== 'built' || current.artifactSha256 === undefined || !current.inspectionAvailable) throw new Error('format artifact is not available for inspection')
  const inspectedArtifactSha256 = digest.parse(inspection.artifactSha256)
  if (inspectedArtifactSha256 !== current.artifactSha256) throw new Error('inspected PDF artifact has changed')
  const expectedPageCount = z.number().int().positive().max(5000).parse(inspection.expectedPageCount)
  if (format === 'pdf' && expectedPageCount !== current.expectedPageCount) throw new Error('PDF inspection page count does not match the generated file')
  const pages = z.array(pageCheckSchema).min(1).max(5000).parse(inspection.pages)
  if (pages.length !== expectedPageCount || new Set(pages.map((page) => page.page)).size !== expectedPageCount
    || pages.some((page) => page.page > expectedPageCount)
    || Array.from({ length: expectedPageCount }, (_, index) => index + 1).some((page) => !pages.some((check) => check.page === page))) {
    throw new Error('inspection must record each final-document page exactly once')
  }
  const branchRoot = join(root, 'drafts', branch)
  const details = FILE_DETAILS[branch][format]
  const prior = formatArtifactSchema.parse(JSON.parse(readFileSync(join(branchRoot, details.metadata), 'utf8')))
  if (prior.artifactSha256 !== current.artifactSha256 || prior.sourceMasterSha256 !== hash(markdown)) throw new Error('format changed while page inspection was being submitted')
  const metadata = formatArtifactSchema.parse({ ...prior, expectedPageCount, pages })
  return persistInspection(branchRoot, details.metadata, metadata, root, branch, format, markdown, masterQuality)
}

async function persistInspection(
  branchRoot: string,
  metadataName: string,
  metadata: z.infer<typeof formatArtifactSchema>,
  root: string,
  branch: PaperTaskBranch,
  format: 'pdf',
  markdown: string,
  masterQuality: PaperTaskBranchQualityState,
): Promise<PaperTaskArtifactStatus> {
  await writeOwnedFile(branchRoot, metadataName, JSON.stringify(metadata))
  return readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
}

async function buildBytes(
  format: PaperTaskExportFormat,
  markdown: string,
  assets: readonly PaperTaskExportAsset[],
): Promise<{ readonly bytes: Buffer; readonly boundaryCheck: z.infer<typeof boundaryCheckSchema>; readonly pageCount?: number; readonly blockers: readonly string[] }> {
  const sourceMasterSha256 = hash(markdown)
  if (format === 'markdown') {
    const projectedMarkdown = portableMarkdown(markdown)
    const bytes = Buffer.from(projectedMarkdown, 'utf8')
    const projectedBack = restoreMarkdownAssetLinks(projectedMarkdown)
    if (projectedBack !== markdown) throw new Error('exported Markdown does not preserve the approved master')
    return {
      bytes,
      boundaryCheck: {
        method: projectedMarkdown === markdown ? 'byte-identical-approved-master' : 'markdown-asset-link-projection',
        passed: true, sourceMasterSha256, sourceBlocks: 1, matchedBlocks: 1,
      },
      blockers: [],
    }
  }
  if (format === 'assets') return buildAssetsArchive(markdown, assets, sourceMasterSha256)
  return renderPaperTaskPdf(markdown, assets)
}

function portableMarkdown(markdown: string): string {
  return mapOutsideCodeFences(markdown, (prose) => prose.replace(
    /(!\[[^\]\n]*\]\()asset:([a-z0-9-]+)(\))/gu,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}assets/${id}.png${suffix}`,
  ))
}

function restoreMarkdownAssetLinks(markdown: string): string {
  return mapOutsideCodeFences(markdown, (prose) => prose.replace(
    /(!\[[^\]\n]*\]\()assets\/([a-z0-9-]+)\.png(\))/gu,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}asset:${id}${suffix}`,
  ))
}

function mapOutsideCodeFences(markdown: string, transform: (prose: string) => string): string {
  const fence = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/gu
  let output = ''
  let previous = 0
  for (const match of markdown.matchAll(fence)) {
    const index = match.index ?? 0
    output += transform(markdown.slice(previous, index))
    output += match[0]
    previous = index + match[0].length
  }
  return output + transform(markdown.slice(previous))
}

async function buildAssetsArchive(
  markdown: string,
  assets: readonly PaperTaskExportAsset[],
  sourceMasterSha256: string,
): Promise<{ readonly bytes: Buffer; readonly boundaryCheck: z.infer<typeof boundaryCheckSchema>; readonly blockers: readonly string[] }> {
  const referenced = referencedAssets(markdown)
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const archive = new JSZip()
  archive.file('README.txt', 'Assets referenced by the approved Markdown master. Image files retain their task-owned asset IDs.\n', { createFolders: false })
  let matchedAssets = 0
  for (const id of referenced) {
    const asset = byId.get(id)
    if (asset?.bytes === undefined) {
      throw new Error(`asset-unavailable:${id}`)
    }
    archive.file(`assets/${id}.png`, Buffer.from(asset.bytes), { createFolders: true })
    matchedAssets += 1
  }
  const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const reopened = await JSZip.loadAsync(bytes)
  for (const id of referenced) {
    const asset = byId.get(id)
    if (asset?.bytes === undefined) continue
    const file = reopened.file(`assets/${id}.png`)
    if (file === null || !Buffer.from(await file.async('nodebuffer')).equals(Buffer.from(asset.bytes))) throw new Error('asset archive does not preserve controlled asset bytes')
  }
  return {
    bytes,
    boundaryCheck: { method: 'referenced-asset-byte-identity', passed: true, sourceMasterSha256, sourceBlocks: referenced.length || 1, matchedBlocks: matchedAssets || (referenced.length === 0 ? 1 : 0) },
    blockers: [],
  }
}

function referencedAssets(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/gu, '').replace(/~~~[\s\S]*?~~~/gu, '')
  const found = new Set<string>()
  for (const match of prose.matchAll(/!\[[^\]\n]*\]\(asset:([a-z0-9-]+)\)/gu)) {
    const id = match[1]
    if (id !== undefined) found.add(id)
  }
  return [...found]
}

function regularFile(path: string, maxBytes: number): boolean {
  if (!existsSync(path)) return false
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes
  } catch {
    return false
  }
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
