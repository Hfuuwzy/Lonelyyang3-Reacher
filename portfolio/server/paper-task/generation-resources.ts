import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readSkillManifest, loadSkillSnapshot, skillResourceFilename } from './skill-resources.mjs'

const DEFAULT_ROOTS = {
  translation: join(homedir(), '.skills', 'myCreatsSkills', 'academic-paper-translation-skill', 'academic-paper-translation-skill'),
  'deep-reading': resolve(process.cwd(), '..', '.opencode', 'skills', 'deep-reading-analyst'),
} as const
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.py', '.js', '.mjs', '.ts'])
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.pdf_cache'])
type Branch = 'translation' | 'deep-reading'
export type GenerationResource = { readonly id: string; readonly relativePath: string; readonly path: string; readonly sha256: string }

function collectSkill(base: string): readonly { readonly relativePath: string; readonly bytes: Buffer }[] {
  const root = realpathSync(base)
  const result: { relativePath: string; bytes: Buffer }[] = []
  const visited = new Set<string>()
  let totalBytes = 0
  const visit = (directory: string, depth: number): void => {
    if (depth > 12) throw new Error('skill resource nesting exceeds its bound')
    const actual = realpathSync(directory)
    const within = relative(root, actual)
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || visited.has(actual)) throw new Error('skill directory escapes or cycles')
    visited.add(actual)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error('descendant skill links must be resolved inside the selected bundle')
      if (stat.isDirectory()) { visit(path, depth + 1); continue }
      if (!stat.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
      if (stat.size > 512 * 1024 || result.length >= 512) throw new Error('skill resource exceeds its bound')
      const bytes = readFileSync(path)
      totalBytes += bytes.byteLength
      if (totalBytes > 8 * 1024 * 1024 || bytes.includes(0)) throw new Error('skill bundle exceeds its textual resource bound')
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      result.push({ relativePath: relative(root, path).split(sep).join('/'), bytes })
    }
  }
  visit(root, 0)
  if (!result.some(entry => entry.relativePath === 'SKILL.md')) throw new Error('selected skill must provide SKILL.md')
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export function snapshotGenerationResources(root: string, branches: readonly Branch[], roots: Partial<Record<Branch, string>> = {}): {
  readonly resources: readonly GenerationResource[]; readonly unavailableBranches: readonly Branch[]
} {
  const directory = join(root, 'generation-resources')
  mkdirSync(directory, { recursive: true })
  const resources: GenerationResource[] = []
  const unavailableBranches: Branch[] = []
  const indexPath = join(directory, 'index.json')
  const prior = existsSync(indexPath) ? readSkillManifest(directory) : undefined
  const manifest: { id: string; relativePath: string; sha256: string }[] = []
  for (const branch of branches) {
    try {
      if (prior !== undefined) {
        loadSkillSnapshot(directory, branch)
        for (const entry of prior.filter(item => item.id.startsWith(`${branch}:`))) {
          resources.push({ ...entry, path: join(directory, skillResourceFilename(branch, entry.relativePath)) })
        }
        continue
      }
      const selected = roots[branch] ?? (branch === 'translation' ? process.env.PAPER_TASK_TRANSLATION_SKILL_ROOT : process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT) ?? DEFAULT_ROOTS[branch]
      const files = collectSkill(selected)
      const entries = files.map(file => ({ id: `${branch}:${file.relativePath.replaceAll('/', ':')}`, relativePath: file.relativePath, sha256: createHash('sha256').update(file.bytes).digest('hex') }))
      if (new Set(files.map(file => skillResourceFilename(branch, file.relativePath).toLowerCase())).size !== files.length) throw new Error('skill snapshot filenames collide')
      for (const [index, file] of files.entries()) {
        const entry = entries[index]
        if (entry === undefined) throw new Error('skill snapshot entry missing')
        const path = join(directory, skillResourceFilename(branch, file.relativePath))
        writeFileSync(path, file.bytes, { flag: 'wx', mode: 0o444 })
        resources.push({ ...entry, path })
      }
      manifest.push(...entries)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      unavailableBranches.push(branch)
    }
  }
  if (prior === undefined) writeFileSync(indexPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o444 })
  return { resources, unavailableBranches }
}

export function generationResourceManifest(root: string) {
  return readSkillManifest(join(root, 'generation-resources'))
}

export function readGenerationResource(root: string, resourceId: string): string | undefined {
  try {
    const entry = generationResourceManifest(root).find(item => item.id === resourceId)
    if (entry === undefined) return undefined
    const branch = resourceId.split(':')[0]
    loadSkillSnapshot(join(root, 'generation-resources'), branch)
    return readFileSync(join(root, 'generation-resources', skillResourceFilename(branch, entry.relativePath)), 'utf8')
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}
