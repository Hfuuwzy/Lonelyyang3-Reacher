import { createHash, randomUUID } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const cliEntry = process.argv[1]
if (cliEntry === undefined) throw new Error('paper task tools require the DSH CLI module context')
const cliRequire = createRequire(resolve(cliEntry))
const dshToolsUrl = pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-tools'))
const { defineTool } = await import(dshToolsUrl.href)

const RECORD_ID_PATTERN = /^p\d{1,10}-r\d{1,10}$/
const RESOURCE_ID_PATTERN = /^(translation|deep-reading):[A-Za-z0-9_:.\/-]+\.md$/
const PAGE_BYTES = 20000, MAX_INPUT_BYTES = 200000, MAX_INDEX_BYTES = 2000000
const MAX_RESOURCE_INDEX_BYTES = 64000, MAX_RECORD_DEPENDENCIES = 200
const PAGE_PARAMETERS = {
  offset: { type: 'integer', description: 'Nonnegative UTF-8 byte offset. Start at 0, then use nextOffset from the preceding page.' },
  limit_bytes: { type: 'integer', description: 'Page size from 4 to 20000 bytes. Omit for the default 20000 bytes.' },
}
const RESOURCE_PATHS = {
  translation: new Set(['SKILL.md', 'references/translation_rules.md', 'references/markdown_rules.md', 'references/dependencies.md', 'references/qa_checklist.md', 'references/vendor_notes.md', 'vendor/pdfs/SKILL.md', 'vendor/docx/SKILL.md']),
  'deep-reading': new Set(['SKILL.md', 'references/5w2h_analysis.md', 'references/comparison_matrix.md', 'references/critical_thinking.md', 'references/first_principles.md', 'references/inversion_thinking.md', 'references/mental_models.md', 'references/output_templates.md', 'references/scqa_framework.md', 'references/six_hats.md', 'references/systems_thinking.md']),
}

export const name = 'paper-task-controlled-tools'
export const inject = ['tools']

export function apply(ctx) {
  const taskRootInput = resolve(process.env.PAPER_TASK_WORKSPACE ?? '')
  const sourceRootInput = resolve(process.env.PAPER_TASK_SOURCE_ROOT ?? '')
  const resourceRootInput = resolve(process.env.PAPER_TASK_RESOURCE_ROOT ?? '')
  const inputPathInput = resolve(process.env.PAPER_TASK_INPUT ?? '')
  const branchRootInput = resolve(process.env.PAPER_TASK_BRANCH_ROOT ?? '')
  const branch = process.env.PAPER_TASK_BRANCH
  const rootKeys = ['PAPER_TASK_WORKSPACE', 'PAPER_TASK_SOURCE_ROOT', 'PAPER_TASK_RESOURCE_ROOT', 'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH_ROOT']
  if (rootKeys.some((key) => !process.env[key]) || !['translation', 'deep-reading'].includes(branch)) {
    throw new Error('paper task tool configuration is invalid')
  }
  const taskRoot = realpathSync(taskRootInput)
  const sourceRoot = realpathSync(sourceRootInput)
  const resourceRoot = realpathSync(resourceRootInput)
  const inputPath = realpathSync(inputPathInput)
  const branchRoot = realpathSync(branchRootInput)
  const piecesRoot = realpathSync(resolve(branchRoot, 'pieces'))
  if ([taskRootInput, sourceRootInput, resourceRootInput, inputPathInput, branchRootInput].some((path, index) => path !== [taskRoot, sourceRoot, resourceRoot, inputPath, branchRoot][index])
    || sourceRoot !== resolve(taskRoot, 'source-records')
    || resourceRoot !== resolve(taskRoot, 'generation-resources')
    || inputPath !== resolve(taskRoot, 'task-input.md')
    || branchRoot !== resolve(taskRoot, 'drafts', branch)
    || piecesRoot !== resolve(branchRoot, 'pieces')) {
    throw new Error('paper task tool directories do not match the assigned task')
  }

  const sourceReads = new Map()
  const resourceReads = new Map()
  const contained = async (root, path) => {
    const actualRoot = await realpath(root)
    const actualPath = await realpath(path)
    assertContained(actualRoot, actualPath)
    return actualPath
  }
  const readBytes = async (root, path, maxBytes) => {
    const actualPath = await contained(root, path)
    if ((await lstat(actualPath)).size > maxBytes) throw new Error('paper task file exceeds its read limit')
    const bytes = await readFile(actualPath)
    if (bytes.byteLength > maxBytes) throw new Error('paper task file exceeds its read limit')
    return bytes
  }
  const readPage = async (root, path, offset, maxBytes, maxFileBytes) => {
    assertPage(offset, maxBytes)
    const bytes = await readBytes(root, path, maxFileBytes)
    if (offset > bytes.byteLength) throw new Error('page offset is outside the file')
    let start = offset
    while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start++
    let end = Math.min(start + maxBytes, bytes.byteLength)
    while (end > start && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--
    const nextOffset = end
    return { bytes, page: JSON.stringify({ offset: start, nextOffset, totalBytes: bytes.byteLength, text: bytes.subarray(start, end).toString('utf8') }), start, end }
  }
  const define = (spec) => ctx.tools.register(defineTool(spec))
  const disposers = []

  disposers.push(define({
    name: 'paper_task_read_input',
    description: 'Read task instructions in bounded byte pages. The JSON result has text, nextOffset, and totalBytes; repeat at nextOffset until it reaches totalBytes.',
    parameters: PAGE_PARAMETERS,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return (await readPage(taskRoot, inputPath, args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, MAX_INPUT_BYTES)).page },
  }))
  disposers.push(define({
    name: 'paper_task_list_sources',
    description: 'List opaque source-record identifiers in bounded pages. The JSON result has items, nextOffset, and totalItems; repeat at nextOffset until it reaches totalItems.',
    parameters: { offset: { type: 'integer', description: 'Nonnegative item offset, initially 0.' }, limit: { type: 'integer', description: 'From 1 to 100 source identifiers, default 50.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const bytes = await readBytes(taskRoot, resolve(taskRoot, 'source-index.json'), MAX_INDEX_BYTES)
      const ids = JSON.parse(bytes.toString('utf8'))
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !RECORD_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) throw new Error('source index is invalid')
      const offset = args.offset ?? 0
      const limit = args.limit ?? 50
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('source page limits are invalid')
      return JSON.stringify({ offset, nextOffset: Math.min(offset + limit, ids.length), totalItems: ids.length, items: ids.slice(offset, offset + limit) })
    },
  }))
  disposers.push(define({
    name: 'paper_task_read_source',
    description: 'Read a source record by opaque identifier in bounded byte pages. The JSON result has text, nextOffset, and totalBytes; repeat at nextOffset until it reaches totalBytes.',
    parameters: { record_id: { type: 'string', required: true }, ...PAGE_PARAMETERS },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (!RECORD_ID_PATTERN.test(args.record_id)) throw new Error('unsupported source record identifier')
      const result = await readPage(sourceRoot, resolve(sourceRoot, `${args.record_id}.json`), args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, MAX_INDEX_BYTES)
      trackRead(sourceReads, args.record_id, result.start, result.end, result.bytes.byteLength, hash(result.bytes))
      return result.page
    },
  }))
  disposers.push(define({
    name: 'paper_task_list_resources',
    description: 'List pinned resource identifiers and content hashes.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const bytes = await readBytes(taskRoot, resolve(resourceRoot, 'index.json'), MAX_RESOURCE_INDEX_BYTES)
      const entries = parseResourceIndex(bytes.toString('utf8'), branch)
      return JSON.stringify(entries.map(({ id, relativePath, sha256 }) => ({ id, relativePath, sha256 })))
    },
  }))
  disposers.push(define({
    name: 'paper_task_read_resource',
    description: 'Read active branch pinned resources in bounded byte pages. The JSON result has text, nextOffset, and totalBytes; repeat at nextOffset until it reaches totalBytes.',
    parameters: { resource_id: { type: 'string', required: true }, ...PAGE_PARAMETERS },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (!RESOURCE_ID_PATTERN.test(args.resource_id) || args.resource_id.includes('..') || !args.resource_id.startsWith(`${branch}:`)) throw new Error('unsupported resource identifier')
      const index = parseResourceIndex((await readBytes(taskRoot, resolve(resourceRoot, 'index.json'), MAX_RESOURCE_INDEX_BYTES)).toString('utf8'), branch)
      const entry = index.find((item) => item.id === args.resource_id)
      if (entry === undefined) throw new Error('resource is unavailable')
      const path = resolve(resourceRoot, `${args.resource_id.replaceAll(':', '--').replaceAll('/', '--')}`)
      const result = await readPage(resourceRoot, path, args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, MAX_INPUT_BYTES)
      const snapshotHash = hash(result.bytes)
      if (snapshotHash !== entry.sha256) throw new Error('pinned resource snapshot changed')
      trackRead(resourceReads, args.resource_id, result.start, result.end, result.bytes.byteLength, snapshotHash)
      return result.page
    },
  }))
  disposers.push(define({
    name: 'paper_task_read_branch',
    description: 'Read this branch preview after it has been saved, in bounded byte pages.',
    parameters: PAGE_PARAMETERS,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return (await readPage(branchRoot, resolve(branchRoot, 'preview.md'), args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, MAX_INPUT_BYTES)).page },
  }))
  disposers.push(define({
    name: 'paper_task_write_branch',
    description: 'Save an unfinished Markdown preview to this branch only.',
    parameters: {
      markdown: { type: 'string', required: true },
      source_record_ids: { type: 'array', required: true, description: 'Every completely read source record used for this preview.', items: { type: 'string' } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (args.markdown.length === 0 || Buffer.byteLength(args.markdown, 'utf8') > MAX_INPUT_BYTES) throw new Error('branch preview exceeds the allowed output size')
      const skillId = `${branch}:SKILL.md`
      const skillRead = resourceReads.get(skillId)
      if (skillRead?.complete !== true) throw new Error('read the complete pinned branch skill before saving a preview')
      const resourceEntries = parseResourceIndex((await readBytes(taskRoot, resolve(resourceRoot, 'index.json'), MAX_RESOURCE_INDEX_BYTES)).toString('utf8'), branch)
      const skillEntry = resourceEntries.find((entry) => entry.id === skillId)
      if (skillEntry === undefined || skillRead.sha256 !== skillEntry.sha256
        || hash(await readBytes(resourceRoot, resolve(resourceRoot, `${skillId.replaceAll(':', '--')}`), MAX_INPUT_BYTES)) !== skillEntry.sha256) throw new Error('pinned branch skill changed after it was read')
      const sourceIds = parseDependencies(args.source_record_ids, sourceReads)
      const indexBytes = await readBytes(taskRoot, resolve(taskRoot, 'source-index.json'), MAX_INDEX_BYTES)
      const indexedIds = JSON.parse(indexBytes.toString('utf8'))
      if (!Array.isArray(indexedIds) || sourceIds.some((id) => !indexedIds.includes(id))) throw new Error('source dependency is unavailable')
      const records = []
      for (const recordId of sourceIds) {
        if (sourceReads.get(recordId)?.complete !== true) throw new Error('read each source dependency completely before saving a preview')
        const sourceBytes = await readBytes(sourceRoot, resolve(sourceRoot, `${recordId}.json`), MAX_INDEX_BYTES)
        if (hash(sourceBytes) !== sourceReads.get(recordId)?.sha256) throw new Error('source record changed after it was read')
        const stored = JSON.parse(sourceBytes.toString('utf8'))
        if (stored.record?.id !== recordId || !Number.isInteger(stored.revision) || stored.revision < 1) throw new Error('source record is unavailable')
        records.push({ id: `${branch}-${recordId}`, dependencies: [{ recordId, revision: stored.revision }], stale: false })
      }
      await writeOwnedFile(branchRoot, 'preview.md', args.markdown)
      for (const record of records) await writeOwnedFile(piecesRoot, `${record.id}.json`, JSON.stringify(record))
      return 'Branch preview saved.'
    },
  }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() })
}

function assertContained(root, path) {
  const pathFromRoot = relative(root, path)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) throw new Error('paper task path is outside the assigned directory')
}

function assertPage(offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 4 || limit > PAGE_BYTES) throw new Error('page limits are invalid: use offset >= 0 and limit_bytes from 4 to 20000, or omit both for the first page')
}

function trackRead(reads, id, start, end, total, sha256) {
  const previous = reads.get(id)
  if (previous !== undefined && previous.sha256 !== sha256) throw new Error('file changed between page reads')
  const ranges = previous?.ranges ?? []
  ranges.push([start, end])
  ranges.sort((left, right) => left[0] - right[0])
  let covered = 0
  for (const [from, to] of ranges) {
    if (from > covered) break
    covered = Math.max(covered, to)
  }
  reads.set(id, { ranges, complete: covered >= total, sha256 })
}

function parseDependencies(ids, reads) {
  if (ids.length === 0 || ids.length > MAX_RECORD_DEPENDENCIES || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !RECORD_ID_PATTERN.test(id) || !reads.has(id))) throw new Error('source dependency list is invalid')
  const readIds = [...reads].filter(([, value]) => value.complete).map(([id]) => id)
  if (readIds.some((id) => !ids.includes(id)) || ids.some((id) => reads.get(id)?.complete !== true)) throw new Error('source dependencies must match completely read records')
  return ids
}

function parseResourceIndex(text, branch) {
  const entries = JSON.parse(text)
  if (!Array.isArray(entries) || entries.some((entry) => entry === null || typeof entry !== 'object'
    || Object.keys(entry).sort().join(',') !== 'id,relativePath,sha256'
    || !RESOURCE_ID_PATTERN.test(entry.id)
    || typeof entry.relativePath !== 'string' || entry.id !== `${entry.id.split(':', 1)[0]}:${entry.relativePath.replaceAll('/', ':')}`
    || !RESOURCE_PATHS[entry.id.split(':', 1)[0]].has(entry.relativePath)
    || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256))) throw new Error('resource index is invalid')
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('resource index is invalid')
  return entries.filter((entry) => entry.id.startsWith(`${branch}:`))
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeOwnedFile(directory, filename, contents) {
  const outputDirectory = await realpath(directory)
  const path = resolve(outputDirectory, filename)
  if (relative(outputDirectory, path).startsWith('..') || isAbsolute(relative(outputDirectory, path))) throw new Error('branch output path is invalid')
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink() || !details.isFile()) throw new Error('branch output path is invalid')
    assertContained(outputDirectory, await realpath(path))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = resolve(outputDirectory, `.${filename}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    try { await unlink(temporary) } catch (cleanupError) {
      if (!(cleanupError instanceof Error) || !('code' in cleanupError) || cleanupError.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }
}
