import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readBytes } from './controlled-files.mjs'
import { readSourceDocument, sourceHash } from './source-document.mjs'
import { loadSkillSnapshot, readSkillResource } from './skill-resources.mjs'
import { documentPage, missingDocumentOffset, trackDocumentRead } from './document-read.mjs'
import { publishDocumentArtifact } from './document-artifact.mjs'
import { manuscriptParagraphs, repairDocumentArtifact, submitDocumentReview } from './document-review.mjs'

const cliEntry = process.argv[1]
if (cliEntry === undefined) throw new Error('paper task tools require the DSH CLI module context')
const cliRequire = createRequire(realpathSync(resolve(cliEntry)))
const { defineTool } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-tools')).href)
const PAGE_PARAMETERS = {
  offset: { type: 'integer', description: 'UTF-8 byte offset, initially 0. Follow nextOffset when it is below totalBytes.' },
  limit_bytes: { type: 'integer', description: 'From 4 to 200000 bytes; default 200000 reads an ordinary paper in one call.' },
}
const REVIEW_CRITERION = { type: 'object', additionalProperties: false, properties: {
  criterion: { type: 'string', required: true }, verdict: { type: 'string', enum: ['satisfied', 'limitation', 'issue'], required: true }, notes: { type: 'string', required: true },
} }
export const name = 'paper-task-controlled-tools'
export const inject = ['tools']

export function apply(ctx) {
  const root = realpathSync(resolve(process.env.PAPER_TASK_WORKSPACE ?? ''))
  const branch = process.env.PAPER_TASK_BRANCH
  if (!['translation', 'deep-reading'].includes(branch)) throw new Error('task branch is unavailable')
  const branchRoot = realpathSync(resolve(process.env.PAPER_TASK_BRANCH_ROOT ?? ''))
  const resourcesRoot = realpathSync(resolve(process.env.PAPER_TASK_RESOURCE_ROOT ?? ''))
  const inputPath = realpathSync(resolve(process.env.PAPER_TASK_INPUT ?? ''))
  if (branchRoot !== join(root, 'drafts', branch) || resourcesRoot !== join(root, 'generation-resources') || inputPath !== join(root, 'task-input.md')) throw new Error('task directories do not match the assigned workspace')
  const source = readSourceDocument(root)
  const skill = loadSkillSnapshot(resourcesRoot, branch)
  let sourceRead, branchRead, publication, review
  let phase = 'generating'
  let publishing = false
  const resourceReads = new Map()
  const disposers = []
  const define = spec => disposers.push(ctx.tools.register(defineTool({ ...spec, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] } })))
  const currentSource = () => {
    const current = readSourceDocument(root)
    if (current.metadata.fingerprint !== source.metadata.fingerprint) throw new Error('source.md changed during this generation attempt')
    return current
  }
  define({
    name: 'paper_task_read_input', description: 'Read task scope, available capabilities, and the selected skill entry point.', parameters: PAGE_PARAMETERS,
    async execute(args) {
      const bytes = await readBytes(root, inputPath, 200000)
      return documentPage({ text: bytes.toString('utf8'), file: 'task-input.md', sha256: sourceHash(bytes), args }).text
    },
  })
  define({
    name: 'paper_task_read_source', description: 'Read the complete shared source.md, not individual extracted records. Default reads up to 200000 original UTF-8 bytes in one call; follow nextOffset only for longer papers. Return text is raw Markdown after a compact cursor header. The header reports actual source-delivery coverage, not comprehension.',
    parameters: PAGE_PARAMETERS, isConcurrencySafe: () => true,
    async execute(args) {
      const current = currentSource()
      const page = documentPage({ text: current.markdown, file: 'source.md', sha256: source.metadata.markdownSha256, args, extra: { sourceStatus: source.metadata.sourceStatus, pageCount: source.metadata.pageCount } })
      sourceRead = trackDocumentRead(sourceRead, page, source.metadata.markdownSha256)
      return page.text
    },
  })
  define({
    name: 'paper_task_search_source', description: 'Find literal text in source.md to locate a relevant page or byte offset. Search snippets do not count as complete whole-paper reading.',
    parameters: { query: { type: 'string', required: true }, limit: { type: 'integer' } },
    async execute(args) {
      if (typeof args.query !== 'string' || args.query.length < 1 || args.query.length > 200 || !Number.isSafeInteger(args.limit ?? 10) || (args.limit ?? 10) < 1 || (args.limit ?? 10) > 20) throw new Error('source search query or limit is invalid')
      const current = currentSource()
      const lower = current.markdown.toLowerCase()
      const results = []
      let position = lower.indexOf(args.query.toLowerCase())
      while (position >= 0 && results.length < (args.limit ?? 10)) {
        const offset = Buffer.byteLength(current.markdown.slice(0, position), 'utf8')
        const page = source.metadata.pages.find(entry => offset >= entry.start && offset < entry.end)?.page
        results.push({ page, offset, snippet: current.markdown.slice(Math.max(0, position - 80), position + args.query.length + 160) })
        position = lower.indexOf(args.query.toLowerCase(), position + args.query.length)
      }
      return JSON.stringify({ matches: results, firstUnreadOffset: missingDocumentOffset(sourceRead) })
    },
  })
  define({
    name: 'paper_task_list_resources', description: 'List the selected skill package resources. Choose references from SKILL.md; there is no application-required framework.',
    parameters: { offset: { type: 'integer' }, limit: { type: 'integer' } },
    async execute(args) {
      const offset = args.offset ?? 0, limit = args.limit ?? 50
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('resource list limits are invalid')
      return JSON.stringify({ entry: skill.entry, totalItems: skill.resources.length, nextOffset: Math.min(offset + limit, skill.resources.length), resources: skill.resources.slice(offset, offset + limit).map(({ path, byteLength }) => ({ path, byteLength })) })
    },
  })
  define({
    name: 'paper_task_read_resource', description: 'Read the selected SKILL.md or a relative resource it references. Resource paths are relative to the skill entry, or to optional from. Follow the skill itself, not a fixed application template. Scripts are readable text only, not executable.',
    parameters: { path: { type: 'string', required: true }, from: { type: 'string' }, ...PAGE_PARAMETERS }, isConcurrencySafe: () => true,
    async execute(args) {
      const item = readSkillResource({ resourcesRoot, branch, path: args.path, from: args.from ?? 'SKILL.md' })
      const page = documentPage({ text: item.text, file: item.path, sha256: item.sha256, args })
      resourceReads.set(item.path, trackDocumentRead(resourceReads.get(item.path), page, item.sha256))
      return page.text
    },
  })
  define({
    name: 'paper_task_write_branch', description: 'Publish this branch as one complete natural Markdown manuscript following the selected skill. Translation is a continuous whole-document translation. No source-record IDs, translation segments, claim ledger, fixed headings, or fact-label prefixes are required. Publish only once; a rejected write may be corrected.',
    parameters: { markdown: { type: 'string', required: true }, limitations: { type: 'array', items: { type: 'string' }, description: 'Specific source, capability, or skill steps that could not be completed honestly.' } },
    async execute(args) {
      if (phase !== 'generating' || publishing) throw new Error('branch generation is already published')
      publishing = true
      try {
        if (!sourceRead?.complete) throw new Error(`read the complete source.md before publishing; continue offset=${missingDocumentOffset(sourceRead)}`)
        const result = await publishDocumentArtifact({ root, branch, markdown: args.markdown, source, skill, sourceRead, resourceReads, limitations: args.limitations ?? [] })
        publication = { ...result, source, skill }
        phase = 'review'
        return 'Manuscript saved. Read it back and review it against the selected skill and task requirements.'
      } finally { publishing = false }
    },
  })
  define({
    name: 'paper_task_read_branch', description: 'Read the saved manuscript for the single skill-aligned content review. Repair target indexes refer to zero-based blank-line-separated manuscript paragraphs.', parameters: PAGE_PARAMETERS,
    async execute(args) {
      if (publication === undefined) throw new Error('no manuscript has been published')
      const bytes = await readBytes(branchRoot, join(branchRoot, 'preview.md'), 400000)
      if (sourceHash(bytes) !== publication.metadata.manuscriptSha256) throw new Error('published manuscript changed before review')
      const page = documentPage({ text: bytes.toString('utf8'), file: 'preview.md', sha256: sourceHash(bytes), args, extra: { paragraphCount: manuscriptParagraphs(publication.markdown).length } })
      branchRead = trackDocumentRead(branchRead, page, sourceHash(bytes))
      return page.text
    },
  })
  define({
    name: 'paper_task_submit_content_review', description: 'Submit exactly one review of the complete manuscript. Derive criteria from the selected skill and user task, not an application framework checklist. Identify substantive issues by manuscript paragraph; source pages are optional context. Unavailable required tools must be disclosed, not claimed complete.',
    parameters: {
      criteria: { type: 'array', required: true, items: REVIEW_CRITERION }, assessment: { type: 'string', required: true },
      findings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        code: { type: 'string', required: true, enum: ['terminology', 'number', 'omission', 'evidence', 'layout', 'other'] }, severity: { type: 'string', required: true, enum: ['minor', 'substantive'] }, description: { type: 'string', required: true },
        target_indexes: { type: 'array', items: { type: 'integer' } }, source_pages: { type: 'array', items: { type: 'integer' } },
      } } },
    },
    async execute(args) {
      if (phase !== 'review' || publication === undefined || review !== undefined) throw new Error('content review is not available or was already submitted')
      if (!branchRead?.complete || branchRead.sha256 !== publication.metadata.manuscriptSha256) throw new Error('read the complete saved manuscript before reviewing it')
      review = await submitDocumentReview({ root, branch, publication, args })
      phase = review.findings.some(finding => finding.severity === 'substantive') ? 'repair' : 'finished'
      return 'Skill-aligned review recorded; the application decides the final status.'
    },
  })
  define({
    name: 'paper_task_apply_local_repair', description: 'Apply at most one repair to paragraphs cited by substantive review findings, preserving other text. Explicitly report which findings were resolved; a changed paragraph alone is not proof of resolution.',
    parameters: {
      targets: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, markdown: { type: 'string', required: true } } } },
      resolutions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { finding_id: { type: 'string', required: true }, resolved: { type: 'boolean', required: true }, explanation: { type: 'string', required: true } } } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
    async execute(args) {
      if (phase !== 'repair' || publication === undefined || review === undefined) throw new Error('local repair is not available or was already attempted')
      phase = 'finished'
      const result = await repairDocumentArtifact({ root, branch, publication, review, args })
      publication = result.publication
      review = result.review
      return 'Local repair recorded; no second review or repair is permitted.'
    },
  })
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() })
}
