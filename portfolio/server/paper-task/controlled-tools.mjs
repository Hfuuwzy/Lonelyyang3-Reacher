import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readBytes, readPage, writeOwnedFile } from './controlled-files.mjs'
import { publishTranslationMaster } from './translation-publication.mjs'
import { inspectDeepReadingReport } from './deep-reading-report.mjs'
import {
  normalizeReviewSubmission,
  planDeepReadingRepair,
  planTranslationRepair,
  repairReadScope,
  splitMarkdownParagraphs,
} from './review-repair.mjs'

const cliEntry = process.argv[1]
if (cliEntry === undefined) throw new Error('paper task tools require the DSH CLI module context')
const cliRequire = createRequire(resolve(cliEntry))
const dshToolsUrl = pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-tools'))
const { defineTool } = await import(dshToolsUrl.href)

const RECORD_ID_PATTERN = /^p\d{1,10}-r\d{1,10}$/
const RESOURCE_ID_PATTERN = /^(translation|deep-reading):[A-Za-z0-9_:.\/-]+\.md$/
const PAGE_BYTES = 20000, MAX_INPUT_BYTES = 200000, MAX_INDEX_BYTES = 2000000
const MAX_RESOURCE_INDEX_BYTES = 64000
const REVIEW_CODES = ['terminology', 'number', 'omission', 'evidence', 'layout', 'other']
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
  const maxBranchBytes = branch === 'translation' ? 400000 : 200000
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
  const branchReads = new Map()
  const postReviewReads = new Map()
  let sourceIndexRead
  let phase = 'generating'
  let publication = null
  let publishing = false
  let review = null
  let reviewPending = false
  let repairAttempted = false
  let repairAllowedRecords = null
  const define = (spec) => ctx.tools.register(defineTool(spec))
  const disposers = []

  async function recordRepair(plan, repairedSha256) {
    const artifact = {
      ...review,
      repair: {
        attempted: true,
        appliedFindingIds: plan.appliedFindingIds,
        residualFindingIds: plan.residualFindingIds,
        changedTargets: plan.changedIndexes,
        repairedSha256,
      },
    }
    await writeOwnedFile(branchRoot, 'review.json', JSON.stringify(artifact))
    review = artifact
  }

  async function restorePublication() {
    if (branch === 'translation') {
      await writeOwnedFile(branchRoot, 'master.md', publication.markdown)
      await writeOwnedFile(branchRoot, 'preview.md', publication.markdown)
      await writeOwnedFile(branchRoot, 'translation.json', JSON.stringify(publication.metadata))
      return
    }
    await writeOwnedFile(branchRoot, 'report.md', publication.markdown)
    await writeOwnedFile(branchRoot, 'preview.md', publication.markdown)
    await writeOwnedFile(branchRoot, 'evidence.json', JSON.stringify(publication.evidence))
  }

  async function recordRejectedRepair() {
    const artifact = {
      ...review,
      repair: {
        attempted: true,
        appliedFindingIds: [],
        residualFindingIds: review.findings.filter((finding) => finding.severity === 'substantive').map((finding) => finding.id),
        changedTargets: [],
        repairedSha256: publication.sha256,
        error: 'repair-rejected',
      },
    }
    await writeOwnedFile(branchRoot, 'review.json', JSON.stringify(artifact))
    review = artifact
  }

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
      const nextOffset = Math.min(offset + limit, ids.length)
      sourceIndexRead = trackItems(sourceIndexRead, offset, nextOffset, ids.length, hash(bytes))
      const result = { offset, nextOffset, totalItems: ids.length, items: ids.slice(offset, nextOffset) }
      const state = JSON.parse((await readBytes(taskRoot, resolve(taskRoot, 'source-state.json'), MAX_INDEX_BYTES)).toString('utf8'))
      result.assets = state.assets.filter((asset) => result.items.includes(asset.recordId))
      if (branch === 'deep-reading') result.status = state.status
      return JSON.stringify(result)
    },
  }))
  disposers.push(define({
    name: 'paper_task_read_source',
    description: 'Read a source record by opaque identifier in bounded byte pages. The JSON result has text, nextOffset, and totalBytes; repeat at nextOffset until it reaches totalBytes.',
    parameters: { record_id: { type: 'string', required: true }, ...PAGE_PARAMETERS },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (!RECORD_ID_PATTERN.test(args.record_id)) throw new Error('unsupported source record identifier')
      if (phase === 'repair' && repairAllowedRecords !== null && !repairAllowedRecords.has(args.record_id)) {
        throw new Error('repair may only re-read cited source context')
      }
      const result = await readPage(sourceRoot, resolve(sourceRoot, `${args.record_id}.json`), args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, MAX_INDEX_BYTES)
      trackRead(sourceReads, args.record_id, result.start, result.end, result.bytes.byteLength, hash(result.bytes))
      if (review !== null) trackRead(postReviewReads, args.record_id, result.start, result.end, result.bytes.byteLength, hash(result.bytes))
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
    async execute(args) {
      const result = await readPage(branchRoot, resolve(branchRoot, 'preview.md'), args.offset ?? 0, args.limit_bytes ?? PAGE_BYTES, maxBranchBytes)
      trackRead(branchReads, 'preview.md', result.start, result.end, result.bytes.byteLength, hash(result.bytes))
      return result.page
    },
  }))
  disposers.push(define({
    name: 'paper_task_write_branch',
    description: branch === 'translation'
      ? 'Save the complete unfinished Chinese translation master as natural Markdown segments, plus its source coverage, terminology, and unresolved-material notes.'
      : 'Save an unfinished whole-paper deep-reading report to this branch only.',
    parameters: {
      ...(branch === 'translation' ? {
        segments: {
          type: 'array', required: true,
          description: 'Natural Chinese Markdown blocks in article order. Each block may cover several source records; do not use a fixed article template or bilingual pairs.',
          items: { type: 'object', additionalProperties: false, properties: {
            markdown: { type: 'string', required: true, description: 'One or more natural paragraphs of the master, without source-position markers.' },
            source_record_ids: { type: 'array', required: true, description: 'Every source record this block draws on.', items: { type: 'string' } },
          } },
        },
        terminology: { type: 'array', description: 'Key term choices that must stay consistent across the whole master.', items: { type: 'object', additionalProperties: false, properties: { source: { type: 'string', required: true }, target: { type: 'string', required: true } } } },
        unresolved: { type: 'array', description: 'Necessary material that is missing, ambiguous, or unrecoverable. Do not guess replacement content.', items: { type: 'object', additionalProperties: false, properties: { record_id: { type: 'string', required: true }, reason: { type: 'string', required: true } } } },
      } : {
        markdown: { type: 'string', required: true },
        source_record_ids: { type: 'array', required: true, description: 'Every indexed source record, all completely read, used by this report.', items: { type: 'string' } },
        claim_evidence: { type: 'array', required: true, description: 'For each important report passage: exact passage substring, fact/inference kind, source record id, verbatim quote, and inference explanation when applicable.', items: { type: 'object', additionalProperties: false, properties: { passage: { type: 'string', required: true }, kind: { type: 'string', enum: ['fact', 'inference'], required: true }, source_record_id: { type: 'string', required: true }, quote: { type: 'string', required: true }, explanation: { type: 'string' } } } },
        uncompleted_reasons: { type: 'array', description: 'Internal reasons why essential source material remains unavailable or unverified.', items: { type: 'string' } },
      }),
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (phase !== 'generating' || publication !== null || publishing) throw new Error('branch generation is already published')
      publishing = true
      try {
      if (branch === 'translation') {
        if (typeof args.markdown === 'string') throw new Error('translation must be saved as natural segments, not one bounded preview string')
      } else if (typeof args.markdown !== 'string' || args.markdown.trim().length === 0 || Buffer.byteLength(args.markdown, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error('branch preview exceeds the allowed output size')
      }
      const skillId = `${branch}:SKILL.md`
      const skillRead = resourceReads.get(skillId)
      if (skillRead?.complete !== true) throw new Error('read the complete pinned branch skill before saving a preview')
      const resourceEntries = parseResourceIndex((await readBytes(taskRoot, resolve(resourceRoot, 'index.json'), MAX_RESOURCE_INDEX_BYTES)).toString('utf8'), branch)
      const skillEntry = resourceEntries.find((entry) => entry.id === skillId)
      if (skillEntry === undefined || skillRead.sha256 !== skillEntry.sha256
        || hash(await readBytes(resourceRoot, resolve(resourceRoot, `${skillId.replaceAll(':', '--')}`), MAX_INPUT_BYTES)) !== skillEntry.sha256) throw new Error('pinned branch skill changed after it was read')
      const indexBytes = await readBytes(taskRoot, resolve(taskRoot, 'source-index.json'), MAX_INDEX_BYTES)
      const indexedIds = JSON.parse(indexBytes.toString('utf8'))
      if (!Array.isArray(indexedIds) || indexedIds.some((id) => typeof id !== 'string' || !RECORD_ID_PATTERN.test(id)) || new Set(indexedIds).size !== indexedIds.length) throw new Error('source index is invalid')
      const state = JSON.parse((await readBytes(taskRoot, resolve(taskRoot, 'source-state.json'), MAX_INDEX_BYTES)).toString('utf8'))
      if (branch === 'translation') {
        const published = await publishTranslationMaster({ args, taskRoot, sourceRoot, branchRoot, indexedIds, sourceReads, sourceIndexRead, indexBytes })
        const markdown = (await readBytes(branchRoot, resolve(branchRoot, 'master.md'), maxBranchBytes)).toString('utf8')
        const metadata = JSON.parse((await readBytes(branchRoot, resolve(branchRoot, 'translation.json'), MAX_INDEX_BYTES)).toString('utf8'))
        publication = { sha256: hash(Buffer.from(markdown)), markdown, metadata, records: published.records, indexedIds, state }
        phase = 'review'
        return published.message
      }
      const sourceIds = args.source_record_ids
      if (!Array.isArray(sourceIds) || sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id) => !indexedIds.includes(id))) throw new Error('source dependency is unavailable')
      if (sourceIndexRead?.complete !== true || sourceIndexRead.sha256 !== hash(indexBytes) || indexedIds.some((id) => sourceReads.get(id)?.complete !== true) || sourceIds.length !== indexedIds.length || indexedIds.some((id) => !sourceIds.includes(id))) throw new Error('deep reading requires complete index discovery and every indexed source record')
      const records = []
      const storedSources = []
      let deepEvidence = null
      for (const recordId of sourceIds) {
        if (sourceReads.get(recordId)?.complete !== true) throw new Error('read each source dependency completely before saving a preview')
        const sourceBytes = await readBytes(sourceRoot, resolve(sourceRoot, `${recordId}.json`), MAX_INDEX_BYTES)
        if (hash(sourceBytes) !== sourceReads.get(recordId)?.sha256) throw new Error('source record changed after it was read')
        const stored = JSON.parse(sourceBytes.toString('utf8'))
        if (stored.record?.id !== recordId || !Number.isInteger(stored.revision) || stored.revision < 1) throw new Error('source record is unavailable')
        records.push({ id: `${branch}-${recordId}`, dependencies: [{ recordId, revision: stored.revision }], stale: false })
        storedSources.push(stored)
      }
      {
        const frameworkEntries = resourceEntries.filter((entry) => entry.id.startsWith('deep-reading:references:'))
        const usedFramework = frameworkEntries.find((entry) => resourceReads.get(entry.id)?.complete === true)
        if (usedFramework === undefined) throw new Error('read a complete pinned analysis framework before saving a deep-reading report')
        const frameworkBytes = await readBytes(resourceRoot, resolve(resourceRoot, usedFramework.id.replaceAll(':', '--').replaceAll('/', '--')), MAX_INPUT_BYTES)
        if (hash(frameworkBytes) !== usedFramework.sha256 || resourceReads.get(usedFramework.id)?.sha256 !== usedFramework.sha256) throw new Error('pinned analysis framework changed after it was read')
        const inspected = inspectDeepReadingReport(args, { records: storedSources, state })
        await writeOwnedFile(branchRoot, 'report.md', args.markdown)
        await writeOwnedFile(branchRoot, 'evidence.json', JSON.stringify(inspected.evidence))
        deepEvidence = inspected.evidence
      }
      await writeOwnedFile(branchRoot, 'preview.md', args.markdown)
      for (const record of records) await writeOwnedFile(piecesRoot, `${record.id}.json`, JSON.stringify(record))
      publication = { sha256: hash(Buffer.from(args.markdown)), markdown: args.markdown, evidence: deepEvidence, records: storedSources, indexedIds, state }
      phase = 'review'
      return 'Branch preview saved.'
      } finally {
        publishing = false
      }
    },
  }))
  disposers.push(define({
    name: 'paper_task_submit_content_review',
    description: 'Submit the single content review of the published branch preview. Findings cite target indexes; substantive content findings must cite known source records. A second review is rejected.',
    parameters: {
      findings: {
        type: 'array', required: true,
        items: { type: 'object', additionalProperties: false, properties: {
          code: { type: 'string', enum: REVIEW_CODES, required: true },
          severity: { type: 'string', enum: ['minor', 'substantive'], required: true },
          description: { type: 'string', required: true },
          target_indexes: { type: 'array', items: { type: 'integer' } },
          record_ids: { type: 'array', items: { type: 'string' } },
        } },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (review !== null || reviewPending) throw new Error('content review was already submitted')
      if (phase !== 'review' || publication === null) throw new Error('content review is not available in this phase')
      reviewPending = true
      try {
      const branchRead = branchReads.get('preview.md')
      if (branchRead?.complete !== true || branchRead.sha256 !== publication.sha256) {
        throw new Error('read the complete published preview before reviewing it')
      }
      const targetCount = branch === 'translation'
        ? publication.metadata.segments.length
        : splitMarkdownParagraphs(publication.markdown).length
      const normalized = normalizeReviewSubmission({ args, baseline: publication.markdown, targetCount, indexedIds: publication.indexedIds })
      const artifact = { version: 1, branch, baselineSha256: publication.sha256, findings: normalized.findings, repair: null }
      await writeOwnedFile(branchRoot, 'review.json', JSON.stringify(artifact))
      review = artifact
      repairAllowedRecords = repairReadScope(normalized.findings, publication.records)
      phase = normalized.findings.some((finding) => finding.severity === 'substantive') ? 'repair' : 'finished'
      return 'Content review recorded.'
      } finally {
        reviewPending = false
      }
    },
  }))
  disposers.push(define({
    name: 'paper_task_apply_local_repair',
    description: 'Apply at most one local repair to targets named by substantive review findings. Re-read every cited source record first; unaffected content must remain unchanged.',
    parameters: {
      targets: {
        type: 'array', required: true,
        items: { type: 'object', additionalProperties: false, properties: {
          index: { type: 'integer', required: true },
          markdown: { type: 'string', required: true },
        } },
      },
      ...(branch === 'translation' ? {
        terminology: { type: 'array', description: 'Optional full replacement of declared terminology after a terminology finding.', items: { type: 'object', additionalProperties: false, properties: { source: { type: 'string', required: true }, target: { type: 'string', required: true } } } },
        unresolved: { type: 'array', description: 'Optional full replacement of unresolved material after an omission finding.', items: { type: 'object', additionalProperties: false, properties: { record_id: { type: 'string', required: true }, reason: { type: 'string', required: true } } } },
      } : {
        uncompleted_reasons: { type: 'array', description: 'Optional replacement of internal uncompleted reasons.', items: { type: 'string' } },
      }),
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (review === null || publication === null) throw new Error('local repair is not available in this phase')
      if (repairAttempted) throw new Error('local repair was already attempted')
      if (phase !== 'repair') throw new Error('local repair is not available in this phase')
      repairAttempted = true
      try {
        const substantive = review.findings.filter((finding) => finding.severity === 'substantive')
        for (const recordId of new Set(substantive.flatMap((finding) => finding.recordIds))) {
          const read = postReviewReads.get(recordId)
          if (read?.complete !== true) throw new Error('read each cited source record again before repairing it')
        }
        if (branch === 'translation') {
          const plan = planTranslationRepair({
            metadata: publication.metadata,
            args,
            findings: review.findings,
            context: { records: publication.records, state: publication.state, indexIds: publication.indexedIds, sourceRevision: publication.metadata.sourceRevision },
          })
          if (Buffer.byteLength(plan.markdown, 'utf8') > maxBranchBytes) throw new Error('local repair exceeds the allowed branch size')
          await writeOwnedFile(branchRoot, 'master.md', plan.markdown)
          await writeOwnedFile(branchRoot, 'preview.md', plan.markdown)
          await writeOwnedFile(branchRoot, 'translation.json', JSON.stringify(plan.metadata))
          await recordRepair(plan, hash(Buffer.from(plan.markdown)))
          publication = { ...publication, sha256: hash(Buffer.from(plan.markdown)), markdown: plan.markdown, metadata: plan.metadata }
        } else {
          const plan = planDeepReadingRepair({
            report: publication.markdown,
            evidence: publication.evidence,
            args,
            findings: review.findings,
            context: { records: publication.records, state: publication.state },
          })
          if (Buffer.byteLength(plan.markdown, 'utf8') > maxBranchBytes) throw new Error('local repair exceeds the allowed branch size')
          await writeOwnedFile(branchRoot, 'report.md', plan.markdown)
          await writeOwnedFile(branchRoot, 'preview.md', plan.markdown)
          await writeOwnedFile(branchRoot, 'evidence.json', JSON.stringify(plan.evidence))
          await recordRepair(plan, hash(Buffer.from(plan.markdown)))
          publication = { ...publication, sha256: hash(Buffer.from(plan.markdown)), markdown: plan.markdown, evidence: plan.evidence }
        }
        phase = 'finished'
        return 'Local repair applied.'
      } catch (error) {
        await restorePublication().catch(() => undefined)
        await recordRejectedRepair().catch(() => undefined)
        phase = 'finished'
        throw error
      }
    },
  }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() })
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

function trackItems(previous, start, end, total, sha256) {
  if (previous !== undefined && (previous.sha256 !== sha256 || previous.total !== total)) throw new Error('source index changed between pages')
  const ranges = [...(previous?.ranges ?? []), [start, end]].sort((left, right) => left[0] - right[0])
  let covered = 0
  for (const [from, to] of ranges) {
    if (from > covered) break
    covered = Math.max(covered, to)
  }
  return { ranges, complete: covered >= total, total, sha256 }
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
