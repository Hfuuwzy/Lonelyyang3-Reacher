import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readSourceDocument, sourceHash } from './source-document.mjs'
import { loadSkillSnapshot } from './skill-resources.mjs'
import { writeOwnedFile } from './controlled-files.mjs'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const resource = z.object({ path: z.string(), sha256: digest, complete: z.boolean() })
export const documentArtifactSchema = z.object({
  version: z.literal(2), branch: z.enum(['translation', 'deep-reading']),
  provenance: z.literal('document-only'), manuscriptSha256: digest,
  source: z.object({
    fingerprint: digest, markdownSha256: digest, pdfSha256: digest, revision: z.number().int().positive(),
    byteLength: z.number().int().nonnegative(), readComplete: z.boolean(),
    readRanges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
  }),
  skill: z.object({ digest, entry: z.literal('SKILL.md'), entrySha256: digest, resourcesRead: z.array(resource).max(512) }),
  limitations: z.array(z.string().min(1).max(2000)).max(100),
  referencedAssets: z.array(z.string().regex(/^asset-[a-z0-9]+$/u)).max(500),
})

export function artifactNames(branch) {
  if (branch === 'translation') return { body: 'master.md', metadata: 'translation.json' }
  if (branch === 'deep-reading') return { body: 'report.md', metadata: 'evidence.json' }
  throw new Error('unsupported task branch')
}

function controlledAssets(markdown, source) {
  const found = new Set()
  for (const match of markdown.matchAll(/!\[[^\]\n]*\]\(([^)\s]+)\)/gu)) {
    const target = match[1]
    if (!target.startsWith('asset:')) throw new Error('manuscript images must reference controlled original assets')
    const id = target.slice(6)
    if (!source.metadata.assets.some(asset => asset.id === id && asset.availability === 'available')) throw new Error('manuscript references a foreign or unavailable asset')
    found.add(id)
  }
  return [...found]
}

export function validateDocumentMarkdown({ branch, markdown, source }) {
  if (typeof markdown !== 'string' || markdown.trim().length === 0
    || Buffer.byteLength(markdown, 'utf8') > (branch === 'translation' ? 400000 : 200000)) throw new Error('manuscript is empty or exceeds the branch limit')
  const referencedAssets = controlledAssets(markdown, source)
  if (branch === 'translation') {
    const bytes = Buffer.from(source.markdown, 'utf8')
    const original = source.metadata.records.map(location => bytes.subarray(location.start, location.end).toString('utf8')).join('\n')
    const translated = markdown.replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    const sourceLetters = (original.match(/\p{L}/gu) ?? []).length
    if ((translated.match(/\p{L}/gu) ?? []).length < sourceLetters * 0.25) throw new Error('translation manuscript is too short to represent the complete source document')
  }
  return referencedAssets
}

export function completeDocumentRanges(ranges, total) {
  let covered = 0
  for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0])) {
    if (start < 0 || end < start || end > total || start > covered) return false
    covered = Math.max(covered, end)
  }
  return covered === total
}

export async function writeDocumentArtifact({ root, branch, markdown, metadata }) {
  const parsed = documentArtifactSchema.parse(metadata)
  if (parsed.branch !== branch || sourceHash(markdown) !== parsed.manuscriptSha256) throw new Error('document publication identity is inconsistent')
  const directory = join(root, 'drafts', branch)
  const names = artifactNames(branch)
  await writeOwnedFile(directory, names.body, markdown)
  await writeOwnedFile(directory, 'preview.md', markdown)
  await writeOwnedFile(directory, names.metadata, JSON.stringify(parsed))
  return { markdown, metadata: parsed }
}

export async function publishDocumentArtifact({ root, branch, markdown, source, skill, sourceRead, resourceReads, limitations = [] }) {
  if (readSourceDocument(root).metadata.fingerprint !== source.metadata.fingerprint) throw new Error('source document changed during generation')
  if (loadSkillSnapshot(join(root, 'generation-resources'), branch).digest !== skill.digest) throw new Error('selected skill changed during generation')
  if (sourceRead?.complete !== true || sourceRead.sha256 !== source.metadata.markdownSha256
    || !completeDocumentRanges(sourceRead.ranges, source.metadata.byteLength)) throw new Error('read the complete source.md before publishing whole-paper work')
  const entry = skill.resources.find(item => item.path === skill.entry)
  const entryRead = resourceReads.get(skill.entry)
  if (entry === undefined || entryRead?.complete !== true || entryRead.sha256 !== entry.sha256) throw new Error('read the complete selected SKILL.md before publishing')
  const metadata = documentArtifactSchema.parse({
    version: 2, branch, provenance: 'document-only', manuscriptSha256: sourceHash(markdown),
    source: {
      fingerprint: source.metadata.fingerprint, markdownSha256: source.metadata.markdownSha256,
      pdfSha256: source.metadata.pdfSha256, revision: source.metadata.sourceRevision,
      byteLength: source.metadata.byteLength, readComplete: true, readRanges: sourceRead.ranges,
    },
    skill: {
      digest: skill.digest, entry: skill.entry, entrySha256: entry.sha256,
      resourcesRead: [...resourceReads].map(([path, receipt]) => ({ path, sha256: receipt.sha256, complete: receipt.complete })),
    },
    limitations, referencedAssets: validateDocumentMarkdown({ branch, markdown, source }),
  })
  return writeDocumentArtifact({ root, branch, markdown, metadata })
}

/** @returns {{kind: 'legacy'} | {kind: 'invalid'} | {kind: 'document', markdown: string, metadata: import('zod').infer<typeof documentArtifactSchema>, source: ReturnType<typeof readSourceDocument>, skill: ReturnType<typeof loadSkillSnapshot>, stale: boolean}} */
export function readDocumentArtifact(root, branch) {
  const directory = join(root, 'drafts', branch)
  const names = artifactNames(branch)
  const path = join(directory, names.metadata)
  if (!existsSync(path)) return { kind: 'legacy' }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object') return { kind: 'invalid' }
    if (raw.version !== 2) return raw.version === undefined || raw.version === 1 ? { kind: 'legacy' } : { kind: 'invalid' }
    const metadata = documentArtifactSchema.parse(raw)
    if (!metadata.source.readComplete || !completeDocumentRanges(metadata.source.readRanges, metadata.source.byteLength)) return { kind: 'invalid' }
    const markdown = readFileSync(join(directory, names.body), 'utf8')
    if (metadata.branch !== branch || metadata.manuscriptSha256 !== sourceHash(markdown)
      || readFileSync(join(directory, 'preview.md'), 'utf8') !== markdown) return { kind: 'invalid' }
    const source = readSourceDocument(root)
    const skill = loadSkillSnapshot(join(root, 'generation-resources'), branch)
    if (skill.digest !== metadata.skill.digest) return { kind: 'invalid' }
    const entry = skill.resources.find(item => item.path === skill.entry)
    if (entry?.sha256 !== metadata.skill.entrySha256
      || !metadata.skill.resourcesRead.some(item => item.path === skill.entry && item.sha256 === entry.sha256 && item.complete)) return { kind: 'invalid' }
    if (new Set(metadata.skill.resourcesRead.map(item => item.path)).size !== metadata.skill.resourcesRead.length
      || metadata.skill.resourcesRead.some(receipt => !skill.resources.some(item => item.path === receipt.path && item.sha256 === receipt.sha256))) return { kind: 'invalid' }
    const stale = source.metadata.fingerprint !== metadata.source.fingerprint
    if (metadata.source.pdfSha256 !== source.metadata.pdfSha256) return { kind: 'invalid' }
    if (!stale) {
      if (metadata.source.markdownSha256 !== source.metadata.markdownSha256
        || metadata.source.revision !== source.metadata.sourceRevision
        || metadata.source.byteLength !== source.metadata.byteLength
        || !completeDocumentRanges(metadata.source.readRanges, source.metadata.byteLength)) return { kind: 'invalid' }
      const assets = validateDocumentMarkdown({ branch, markdown, source })
      if (JSON.stringify(assets) !== JSON.stringify(metadata.referencedAssets)) return { kind: 'invalid' }
    }
    return { kind: 'document', markdown, metadata, source, skill, stale }
  } catch (error) {
    if (error instanceof Error) return { kind: 'invalid' }
    throw error
  }
}

export function documentAssets(document) {
  return document.source.metadata.assets.filter(asset => document.metadata.referencedAssets.includes(asset.id)).map(asset => ({
    id: asset.id, kind: asset.kind, caption: asset.caption,
    availability: asset.availability === 'available' ? 'available' : 'missing',
  }))
}
