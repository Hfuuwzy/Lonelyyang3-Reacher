import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

const TRANSLATION_ROOT = join(homedir(), '.skills', 'myCreatsSkills', 'academic-paper-translation-skill', 'academic-paper-translation-skill')
const DEEP_READING_ROOT = resolve(process.cwd(), '..', '.opencode', 'skills', 'deep-reading-analyst')

const TRANSLATION_FILES = [
  'SKILL.md',
  'references/translation_rules.md',
  'references/markdown_rules.md',
  'references/dependencies.md',
  'references/qa_checklist.md',
  'references/vendor_notes.md',
  'vendor/pdfs/SKILL.md',
  'vendor/docx/SKILL.md',
] as const

const DEEP_READING_FILES = [
  'SKILL.md',
  'references/5w2h_analysis.md',
  'references/comparison_matrix.md',
  'references/critical_thinking.md',
  'references/first_principles.md',
  'references/inversion_thinking.md',
  'references/mental_models.md',
  'references/output_templates.md',
  'references/scqa_framework.md',
  'references/six_hats.md',
  'references/systems_thinking.md',
] as const

export type GenerationResource = {
  readonly id: string
  readonly relativePath: string
  readonly path: string
  readonly sha256: string
}

class PinnedSkillMismatchError extends Error {
  override readonly name = 'PinnedSkillMismatchError'
}

export function snapshotGenerationResources(
  root: string,
  branches: readonly ('translation' | 'deep-reading')[],
  roots: { readonly translation?: string; readonly 'deep-reading'?: string } = {},
): {
  readonly resources: readonly GenerationResource[]
  readonly unavailableBranches: readonly ('translation' | 'deep-reading')[]
} {
  const directory = join(root, 'generation-resources')
  mkdirSync(directory, { recursive: true })
  const selected: { readonly prefix: 'translation' | 'deep-reading'; readonly base: string; readonly files: readonly string[] }[] = []
  if (branches.includes('translation')) selected.push({ prefix: 'translation', base: resolve(roots.translation ?? process.env.PAPER_TASK_TRANSLATION_SKILL_ROOT ?? TRANSLATION_ROOT), files: TRANSLATION_FILES })
  if (branches.includes('deep-reading')) selected.push({ prefix: 'deep-reading', base: resolve(roots['deep-reading'] ?? process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT ?? DEEP_READING_ROOT), files: DEEP_READING_FILES })
  const resources: GenerationResource[] = []
  const unavailableBranches: ('translation' | 'deep-reading')[] = []
  const indexPath = join(directory, 'index.json')
  let priorManifest: readonly { readonly id: string; readonly relativePath: string; readonly sha256: string }[] | undefined
  try {
    if (lstatSync(indexPath).isSymbolicLink()) throw new PinnedSkillMismatchError()
    const actualIndex = realpathSync(indexPath)
    const indexRelative = relative(realpathSync(directory), actualIndex)
    if (indexRelative === '..' || indexRelative.startsWith(`..${sep}`) || isAbsolute(indexRelative)) throw new PinnedSkillMismatchError()
    priorManifest = generationResourceManifest(root)
  } catch (error) {
    if (error instanceof PinnedSkillMismatchError) throw error
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  for (const skill of selected) {
    try {
      if (priorManifest !== undefined) {
        const branchEntries = priorManifest.filter((entry) => entry.id.startsWith(`${skill.prefix}:`))
        if (branchEntries.length !== skill.files.length || new Set(branchEntries.map((entry) => entry.id)).size !== skill.files.length) throw new PinnedSkillMismatchError()
        const branchResources = branchEntries.map((entry) => {
          const expectedPath = skill.files.find((relativePath) => entry.id === `${skill.prefix}:${relativePath.replaceAll('/', ':')}`)
          if (expectedPath !== entry.relativePath) throw new PinnedSkillMismatchError()
          const path = join(directory, resourceFilename(entry.id))
          const actualPath = realpathSync(path)
          const actualRelative = relative(realpathSync(directory), actualPath)
          if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) throw new PinnedSkillMismatchError()
          const bytes = readFileSync(actualPath)
          if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256
            || (skill.prefix === 'translation' && entry.relativePath === 'SKILL.md' && !hasPinnedTranslationIdentity(bytes.toString('utf8')))) throw new PinnedSkillMismatchError()
          return { id: entry.id, relativePath: entry.relativePath, path, sha256: entry.sha256 }
        })
        resources.push(...branchResources)
        continue
      }
      const base = realpathSync(skill.base)
      const contents: { readonly id: string; readonly relativePath: string; readonly bytes: Buffer; readonly sha256: string }[] = []
      for (const relativePath of skill.files) {
        const id = `${skill.prefix}:${relativePath.replaceAll('/', ':')}`
        const sourcePath = resolve(skill.base, relativePath)
        const actualPath = realpathSync(sourcePath)
        const actualRelative = relative(base, actualPath)
        if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) throw new PinnedSkillMismatchError()
        const bytes = readFileSync(actualPath)
        if (skill.prefix === 'translation' && relativePath === 'SKILL.md' && !hasPinnedTranslationIdentity(bytes.toString('utf8'))) {
          throw new PinnedSkillMismatchError()
        }
        contents.push({ id, relativePath, bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
      }
      for (const item of contents) existingSnapshot(join(directory, resourceFilename(item.id)), item.bytes)
      const branchResources: GenerationResource[] = []
      for (const item of contents) {
        const path = join(directory, resourceFilename(item.id))
        if (existingSnapshot(path, item.bytes) === false) writeFileSync(path, item.bytes, { flag: 'wx', mode: 0o444 })
        branchResources.push({ id: item.id, relativePath: item.relativePath, path, sha256: item.sha256 })
      }
      resources.push(...branchResources)
    } catch (error) {
      unavailableBranches.push(skill.prefix)
      if (!(error instanceof PinnedSkillMismatchError)
        && (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code)))) throw error
    }
  }
  const manifest = resources.map(({ id, relativePath, sha256 }) => ({ id, relativePath, sha256 }))
  if (priorManifest === undefined) {
    writeFileSync(indexPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o444 })
  }
  return { resources, unavailableBranches }
}

function hasPinnedTranslationIdentity(contents: string): boolean {
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1]
  if (frontmatter === undefined) return false
  const name = frontmatter.match(/^name:\s*(\S+)\s*$/mu)?.[1]
  const version = frontmatter.match(/^version:\s*(\S+)\s*$/mu)?.[1]
  return name === 'academic-paper-zh-translation' && version === '1.1.0'
}

export function readGenerationResource(root: string, resourceId: string): string | undefined {
  if (!/^(translation|deep-reading):[A-Za-z0-9_:.\/-]+\.md$/.test(resourceId) || resourceId.includes('..')) return undefined
  const path = join(root, 'generation-resources', resourceFilename(resourceId))
  try {
    const actualRoot = realpathSync(join(root, 'generation-resources'))
    const actualPath = realpathSync(path)
    const actualRelative = relative(actualRoot, actualPath)
    if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) return undefined
    const bytes = readFileSync(actualPath)
    const manifestEntry = generationResourceManifest(root).find((entry) => entry.id === resourceId)
    if (manifestEntry === undefined || createHash('sha256').update(bytes).digest('hex') !== manifestEntry.sha256) return undefined
    return bytes.toString('utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export function generationResourceManifest(root: string): readonly { readonly id: string; readonly relativePath: string; readonly sha256: string }[] {
  return z.array(z.object({ id: z.string(), relativePath: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) }).strict())
    .parse(JSON.parse(readFileSync(join(root, 'generation-resources', 'index.json'), 'utf8')))
}

function resourceFilename(id: string): string {
  return id.replaceAll(':', '--').replaceAll('/', '--')
}

function existingSnapshot(path: string, expected: Buffer): boolean {
  try {
    const actual = readFileSync(path)
    if (!actual.equals(expected)) throw new PinnedSkillMismatchError()
    return true
  } catch (error) {
    if (error instanceof PinnedSkillMismatchError) throw error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
