import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import { z } from 'zod'

const manifestSchema = z.array(z.object({
  id: z.string(), relativePath: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).passthrough()).max(1024)

export function normalizedSkillPath(path, from = 'SKILL.md') {
  if (typeof path !== 'string' || path.length === 0 || /[\u0000:]/u.test(path) || /^[\\/]/u.test(path) || isAbsolute(path)) throw new Error('skill resource path must be relative')
  const normalized = posix.normalize(posix.join(posix.dirname(from.replaceAll('\\', '/')), path.replaceAll('\\', '/')))
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') throw new Error('skill resource escapes the selected skill')
  return normalized
}

export function skillResourceFilename(branch, path) {
  return `${branch}--${path.replaceAll('/', '--')}`
}

export function readSkillManifest(resourcesRoot) {
  const path = join(resourcesRoot, 'index.json')
  if (lstatSync(path).isSymbolicLink()) throw new Error('skill manifest cannot be a symbolic link')
  const bytes = readFileSync(path)
  if (bytes.byteLength > 512_000) throw new Error('skill manifest exceeds its bound')
  return manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
}

export function loadSkillSnapshot(resourcesRoot, branch) {
  if (!['translation', 'deep-reading'].includes(branch)) throw new Error('unsupported task branch')
  const root = realpathSync(resourcesRoot)
  const entries = readSkillManifest(root).filter(entry => entry.id.startsWith(`${branch}:`))
  if (entries.length === 0 || entries.length > 512) throw new Error('selected skill snapshot is unavailable')
  let totalBytes = 0
  const resources = entries.map(entry => {
    const path = normalizedSkillPath(entry.relativePath)
    if (path !== entry.relativePath || entry.id !== `${branch}:${path.replaceAll('/', ':')}`) throw new Error('skill manifest resource identity is invalid')
    const file = join(root, skillResourceFilename(branch, path))
    const stat = lstatSync(file)
    const within = relative(root, realpathSync(file))
    if (!stat.isFile() || stat.isSymbolicLink() || within.startsWith(`..${sep}`) || isAbsolute(within) || stat.size > 512 * 1024) throw new Error('skill snapshot resource is invalid')
    const bytes = readFileSync(file)
    totalBytes += bytes.byteLength
    if (totalBytes > 8 * 1024 * 1024) throw new Error('skill snapshot exceeds its total byte bound')
    if (hash(bytes) !== entry.sha256) throw new Error('skill snapshot resource changed')
    return { path, sha256: entry.sha256, byteLength: bytes.byteLength }
  }).sort((left, right) => left.path.localeCompare(right.path))
  if (!resources.some(resource => resource.path === 'SKILL.md')) throw new Error('selected skill must provide SKILL.md')
  if (new Set(resources.map(resource => resource.path.toLowerCase())).size !== resources.length) throw new Error('skill snapshot paths collide')
  return { entry: 'SKILL.md', digest: hash(JSON.stringify(resources)), resources }
}

export function readSkillResource({ resourcesRoot, branch, path, from = 'SKILL.md' }) {
  const snapshot = loadSkillSnapshot(resourcesRoot, branch)
  if (!snapshot.resources.some(resource => resource.path === from)) throw new Error('referring skill resource is unavailable')
  const resolved = normalizedSkillPath(path, from)
  const resource = snapshot.resources.find(entry => entry.path === resolved)
  if (resource === undefined) throw new Error('resource is not part of the selected skill snapshot')
  const bytes = readFileSync(join(resourcesRoot, skillResourceFilename(branch, resolved)))
  return { text: bytes.toString('utf8'), path: resolved, sha256: resource.sha256 }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}
