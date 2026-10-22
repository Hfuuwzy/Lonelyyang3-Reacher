import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  PAPER_TASK_QUALITY_LIMITS,
  type PaperTaskBranch,
  type PaperTaskQualityOption,
  type PaperTaskQualityState,
} from '../../app/utils/paper-task-contract'
import type { PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import { readPaperTaskImageReceipts } from './image-receipts'
import { translationBlockers } from './translation-eligibility.mjs'
import { workspacePaths } from './workspace'
import { readDocumentArtifact } from './document-artifact.mjs'
import { evaluateDocumentQuality } from './document-review.mjs'

export type PaperTaskBranchQualityStatus = PaperTaskQualityState | 'failed'
export type PaperTaskQualityIssueSeverity = 'minor' | 'substantive'

export interface PaperTaskQualityIssue {
  readonly code: string
  readonly severity: PaperTaskQualityIssueSeverity
  readonly message: string
  readonly recordIds: readonly string[]
}

export interface PaperTaskBranchQuality {
  readonly status: PaperTaskBranchQualityStatus
  readonly issues: readonly PaperTaskQualityIssue[]
  readonly options: readonly PaperTaskQualityOption[]
  readonly reviewCompleted: boolean
}

type StoredRecord = {
  readonly record: {
    readonly id: string
    readonly order: number
    readonly kind: string
    readonly text: string
    readonly state: string
    readonly sectionId: string | null
    readonly context: string
  }
  readonly revision: number
}

type SourceAsset = {
  readonly id: string
  readonly recordId: string
  readonly availability: 'available' | 'unavailable'
  readonly understanding: 'unverified'
  readonly relativePath: string | null
}

type SourceState = {
  readonly status: 'complete' | 'incomplete' | 'needs-confirmation'
  readonly revision: number
  readonly assets: readonly SourceAsset[]
}

const TEXT_KINDS = new Set(['heading', 'body', 'appendix', 'footnote', 'figure'])
const VISUAL_KINDS = new Set(['table', 'formula', 'algorithm'])
const REVIEW_OPTIONS: readonly PaperTaskQualityOption[] = ['keep-readable', 'inspect-source', 'regenerate']
const PREVIEW_OPTIONS: readonly PaperTaskQualityOption[] = ['regenerate', 'inspect-source']

const translationMetadataSchema = z.object({
  status: z.enum(['complete', 'incomplete', 'needs-update']),
  sourceRevision: z.number().int().positive(),
  masterSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  segments: z.array(z.object({
    index: z.number().int().nonnegative(),
    markdown: z.string().min(1),
    stale: z.boolean(),
    dependencies: z.array(z.object({
      recordId: z.string().regex(/^p\d+-r\d+$/u),
      revision: z.number().int().positive(),
    })),
  }).strict()).min(1),
  terminology: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) }).strict()),
  unresolved: z.array(z.object({ recordId: z.string().regex(/^p\d+-r\d+$/u), reason: z.string().min(1) }).strict()),
  assets: z.array(z.object({
    id: z.string().regex(/^asset-[0-9a-z]+$/u),
    recordId: z.string().regex(/^p\d+-r\d+$/u),
    kind: z.enum(['table', 'formula', 'algorithm', 'figure', 'body', 'heading', 'appendix', 'footnote', 'reference', 'gap']),
    caption: z.string().min(1),
    availability: z.enum(['available', 'missing']),
  }).strict()),
}).passthrough()

const deepReadingEvidenceSchema = z.object({
  manuscriptSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.enum(['preview', 'needs-confirmation']),
  claims: z.array(z.object({
    passage: z.string().min(1),
    kind: z.enum(['fact', 'inference']),
    explanation: z.string().nullable().optional(),
    evidence: z.array(z.object({
      recordId: z.string().regex(/^p\d+-r\d+$/u),
      revision: z.number().int().positive(),
      quote: z.string().min(1),
    }).strict()).min(1),
  }).strict()),
  assets: z.array(z.object({
    id: z.string().regex(/^asset-[0-9a-z]+$/u),
    recordId: z.string().regex(/^p\d+-r\d+$/u),
    availability: z.enum(['available', 'unavailable']),
    understanding: z.literal('unverified'),
    relativePath: z.string().nullable(),
  }).passthrough()),
  uncompletedReasons: z.array(z.string()),
  unresolvedRecordIds: z.array(z.string()),
  qualityIssues: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    recordIds: z.array(z.string()).optional(),
  }).passthrough()).optional(),
}).passthrough()

const reviewArtifactSchema = z.object({
  version: z.literal(1),
  branch: z.enum(['translation', 'deep-reading']),
  baselineSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  findings: z.array(z.object({
    id: z.string().regex(/^f\d+$/u),
    code: z.enum(['terminology', 'number', 'omission', 'evidence', 'layout', 'other']),
    severity: z.enum(['minor', 'substantive']),
    description: z.string().min(1).max(500),
    targetIndexes: z.array(z.number().int().nonnegative()),
    recordIds: z.array(z.string()),
  }).strict()),
  repair: z.object({
    attempted: z.literal(true),
    appliedFindingIds: z.array(z.string()),
    residualFindingIds: z.array(z.string()),
    changedTargets: z.array(z.number().int().nonnegative()),
    repairedSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    error: z.string().optional(),
  }).strict().nullable(),
}).strict()

export function evaluateBranchQuality(root: string, branch: PaperTaskBranch): PaperTaskBranchQuality {
  const document = readDocumentArtifact(root, branch)
  if (document.kind !== 'legacy') return evaluateDocumentQuality(root, branch, document)
  const paths = workspacePaths(root)
  const branchRoot = paths.branchDirectories[branch]
  const source = readSource(paths.sourceRecordsDir, join(paths.root, 'source-index.json'), paths.sourceStatePath)
  if (source === undefined) return failed('source-records-unavailable')
  const recordsById = new Map(source.records.map((stored) => [stored.record.id, stored]))
  const review = readReview(branchRoot, branch)
  const issues: PaperTaskQualityIssue[] = []
  const add = (code: string, message: string, recordIds: readonly string[] = [], severity: PaperTaskQualityIssueSeverity = 'substantive') => {
    issues.push({ code, severity, message: message.slice(0, PAPER_TASK_QUALITY_LIMITS.maxIssueLength), recordIds: [...new Set(recordIds)].sort() })
  }
  const output = branch === 'translation'
    ? readTranslation(branchRoot)
    : readDeepReading(branchRoot)
  if (output === undefined) return failed('output-invalid', issues)
  const reviewState = {
    ...review,
    stale: review.artifact === undefined ? false : reviewIsStale(review.artifact, output.sha256),
  }
  addReviewIssues(reviewState, output.sha256, branch, add)
  if ('metadata' in output) {
    inspectTranslationSource(output.metadata, source, recordsById, branchRoot, add)
    const blockers = translationBlockers({
      records: source.records,
      segments: output.metadata.segments,
      unresolved: output.metadata.unresolved,
      sourceStatus: source.state.status,
      translationStatus: output.metadata.status,
    })
    for (const code of blockers) add(code, translationBlockerMessage(code))
    if (blockers.length > 0) return failed('translation-ineligible', issues)
  } else {
    inspectDeepReadingEvidence(output.evidence, source, recordsById, branchRoot, add)
  }
  inspectReceipts(root, branch, source, add)
  const substantive = issues.filter((issue) => issue.severity === 'substantive')
  if (substantive.length > 0) {
    return { status: 'needs-confirmation', issues, options: REVIEW_OPTIONS, reviewCompleted: review.completed }
  }
  if (!review.completed || reviewState.stale) {
    add('review-incomplete', reviewState.stale ? '内容审阅与当前成品不一致，请重新生成或人工核对。' : '内容审阅尚未完成；模型停止不等于检查通过。', [], 'minor')
    return { status: 'preview', issues, options: PREVIEW_OPTIONS, reviewCompleted: false }
  }
  return { status: 'complete', issues, options: [], reviewCompleted: true }
}

function translationBlockerMessage(code: string): string {
  const messages: Record<string, string> = {
    'covered-and-unresolved': '同一原文记录不能同时列为已翻译和未解决。',
    'gap-translated': '不可恢复的原文记录不能作为已翻译内容。',
    'ambiguous-translated': '模糊或缺失的原文记录必须列为未解决。',
    'disclosure-missing': '未完成译文必须向读者说明待确认内容。',
    'record-uncovered': '有原文的文本记录未翻译，也未声明为未解决。',
    'translation-no-prose': '原文有可翻译正文，但主稿没有呈现译文正文。',
    'master-too-short': '与原文正文关联的译文严重过短。',
  }
  return messages[code] ?? '翻译主稿不符合读者发布条件。'
}

function reviewIsStale(artifact: z.infer<typeof reviewArtifactSchema>, sha256: string): boolean {
  if (artifact.repair === null || artifact.repair.error !== undefined) return artifact.baselineSha256 !== sha256
  return artifact.repair.repairedSha256 !== sha256
}

function failed(code: string, issues: readonly PaperTaskQualityIssue[] = []): PaperTaskBranchQuality {
  const base = issues.length > 0 ? issues : [{ code, severity: 'substantive' as const, message: '成果文件不可用或前后不一致。', recordIds: [] }]
  return { status: 'failed', issues: base, options: [], reviewCompleted: false }
}

function readSource(recordsDir: string, indexPath: string, statePath: string): { readonly records: readonly StoredRecord[]; readonly state: SourceState } | undefined {
  try {
    const ids = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !/^p\d{1,10}-r\d{1,10}$/u.test(id))) return undefined
    const records = ids.map((id) => JSON.parse(readFileSync(join(recordsDir, `${id}.json`), 'utf8')) as StoredRecord)
    if (records.some((stored) => typeof stored.record?.id !== 'string' || typeof stored.revision !== 'number')) return undefined
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as SourceState
    if (!['complete', 'incomplete', 'needs-confirmation'].includes(state.status) || !Array.isArray(state.assets)) return undefined
    return { records, state }
  } catch {
    return undefined
  }
}

function readTranslation(
  branchRoot: string,
): { readonly sha256: string; readonly metadata: z.infer<typeof translationMetadataSchema> } | undefined {
  try {
    const markdown = readFileSync(join(branchRoot, 'master.md'), 'utf8')
    const preview = readFileSync(join(branchRoot, 'preview.md'), 'utf8')
    const parsed = translationMetadataSchema.safeParse(JSON.parse(readFileSync(join(branchRoot, 'translation.json'), 'utf8')))
    const sha256 = hash(markdown)
    if (!parsed.success || preview !== markdown || parsed.data.masterSha256 !== sha256) return undefined
    if (parsed.data.segments.map((segment) => segment.markdown).join('\n\n') !== markdown) return undefined
    return { sha256, metadata: parsed.data }
  } catch {
    return undefined
  }
}

function readDeepReading(
  branchRoot: string,
): { readonly sha256: string; readonly evidence: z.infer<typeof deepReadingEvidenceSchema> } | undefined {
  try {
    const report = readFileSync(join(branchRoot, 'report.md'), 'utf8')
    const preview = readFileSync(join(branchRoot, 'preview.md'), 'utf8')
    const parsed = deepReadingEvidenceSchema.safeParse(JSON.parse(readFileSync(join(branchRoot, 'evidence.json'), 'utf8')))
    const sha256 = hash(report)
    if (!parsed.success || preview !== report || parsed.data.manuscriptSha256 !== sha256) return undefined
    return { sha256, evidence: parsed.data }
  } catch {
    return undefined
  }
}

function addReviewIssues(
  review: { readonly completed: boolean; readonly stale: boolean; readonly artifact?: z.infer<typeof reviewArtifactSchema> },
  sha256: string,
  branch: PaperTaskBranch,
  add: (code: string, message: string, recordIds?: readonly string[], severity?: PaperTaskQualityIssueSeverity) => void,
): void {
  if (!review.completed || review.artifact === undefined) return
  const artifact = review.artifact
  if (artifact.branch !== branch) {
    add('review-branch-mismatch', '内容审阅记录不属于当前分支。')
    return
  }
  if (review.stale) return
  const substantive = artifact.findings.filter((finding) => finding.severity === 'substantive')
  const applied = new Set(artifact.repair?.appliedFindingIds ?? [])
  const residual = new Set(artifact.repair?.residualFindingIds ?? [])
  for (const finding of substantive) {
    if (applied.has(finding.id) && !residual.has(finding.id) && artifact.repair?.error === undefined && artifact.repair?.repairedSha256 === sha256) continue
    add(`review-${finding.code}`, finding.description, finding.recordIds)
  }
}

function inspectTranslationSource(
  metadata: z.infer<typeof translationMetadataSchema>,
  source: { readonly records: readonly StoredRecord[]; readonly state: SourceState },
  recordsById: ReadonlyMap<string, StoredRecord>,
  branchRoot: string,
  add: (code: string, message: string, recordIds?: readonly string[], severity?: PaperTaskQualityIssueSeverity) => void,
): void {
  const indexedIds = source.records.map((stored) => stored.record.id)
  const covered = new Set(metadata.segments.flatMap((segment) => segment.dependencies.map((dependency) => dependency.recordId)))
  const unresolved = new Set(metadata.unresolved.map((item) => item.recordId))
  if (metadata.status === 'needs-update') add('master-stale', '原文修正后主稿尚未更新，不能标为完整。', [...unresolved])
  if (metadata.status === 'incomplete') add('master-incomplete', '主稿仍包含未解决材料，不能标为完整。', [...unresolved])
  for (const item of metadata.unresolved) {
    add('unresolved-material', item.reason, [item.recordId])
  }
  for (const id of indexedIds) {
    if (!covered.has(id) && !unresolved.has(id)) add('missing-coverage', '必要原文记录未出现在主稿或未解决清单中。', [id])
    const record = recordsById.get(id)?.record
    if (record !== undefined && (record.kind === 'gap' || record.state !== 'present') && !unresolved.has(id)) {
      add('source-not-recovered', '缺失或模糊的原文记录未声明为未解决。', [id])
    }
  }
  if (source.state.status === 'incomplete') add('source-incomplete', '原文准备仍有缺失，成果不能标为完整。')
  if (source.state.status === 'needs-confirmation') add('source-needs-confirmation', '原文准备仍有需确认内容，成果不能标为完整。')
  const assetById = new Map(source.state.assets.map((asset) => [asset.id, asset]))
  const referenced = referencedAssetIds(metadata.segments.map((segment) => segment.markdown).join('\n\n'))
  for (const asset of source.state.assets) {
    if (asset.availability !== 'available') add('asset-unavailable', '必要原文图表裁切不可用，成果不能标为完整。', [asset.recordId])
    else if (!isReadablePng(join(branchRoot, '..', '..', 'assets', `${asset.id}.png`))) add('asset-damaged', '原文图表裁切文件缺失或不可读。', [asset.recordId])
    const record = recordsById.get(asset.recordId)?.record
    if (record === undefined || unresolved.has(record.id)) continue
    if (record.kind === 'figure' && !referenced.has(asset.id)) add('figure-unreferenced', '保留的原文图表未在主稿中引用。', [record.id])
    if (VISUAL_KINDS.has(record.kind) && (asset.availability !== 'available' || !referenced.has(asset.id))) {
      add('visual-unreferenced', '必要原文表格、公式或算法未以原始裁切保留。', [record.id])
    }
  }
  for (const assetId of referenced) {
    const asset = assetById.get(assetId)
    if (asset === undefined || asset.availability !== 'available') add('asset-unresolved', '主稿引用了不可用或不属于本任务的原文裁切。')
  }
  const compactMaster = metadata.segments.map((segment) => segment.markdown.replace(/\s+/gu, ''))
  for (const segment of metadata.segments) {
    for (const dependency of segment.dependencies) {
      const record = recordsById.get(dependency.recordId)?.record
      if (record === undefined || !TEXT_KINDS.has(record.kind)) continue
      for (const match of numericSourceText(record).matchAll(/\d+(?:[.,]\d+)*\s*%?/gu)) {
        const token = match[0].replace(/\s+/gu, '')
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
        if (!new RegExp(`(?:^|[^\\d.,])${escaped}(?![\\d.,])`, 'u').test(segment.markdown.replace(/\s+/gu, ''))) {
          add('number-mismatch', '依赖原文记录中的数字或单位在主稿对应段落中缺失或被改动。', [dependency.recordId])
        }
      }
    }
  }
  const compact = compactMaster.join('')
  const seenTerms = new Set()
  for (const term of metadata.terminology) {
    if (seenTerms.has(term.source)) add('terminology-duplicate', '同一原文术语声明了多个译法。')
    seenTerms.add(term.source)
    if (!compact.includes(term.target.replace(/\s+/gu, ''))) add('terminology-missing', '声明术语未在主稿中使用。')
  }
  for (const stored of source.records) {
    if (stored.record.kind !== 'reference' || stored.record.state !== 'present') continue
    if (!compact.includes(stored.record.text.replace(/\s+/gu, ''))) add('reference-not-preserved', '参考文献条目未保留原文英文文本。', [stored.record.id])
  }
}

function inspectDeepReadingEvidence(
  evidence: z.infer<typeof deepReadingEvidenceSchema>,
  source: { readonly records: readonly StoredRecord[]; readonly state: SourceState },
  recordsById: ReadonlyMap<string, StoredRecord>,
  branchRoot: string,
  add: (code: string, message: string, recordIds?: readonly string[], severity?: PaperTaskQualityIssueSeverity) => void,
): void {
  if (evidence.status === 'needs-confirmation') add('uncompleted-material', '深读报告保留了未完成或未核实材料，不能标为完整。', evidence.unresolvedRecordIds)
  if (evidence.uncompletedReasons.length > 0) add('uncompleted-reasons', '深读报告记录了未完成原因，需要人工确认。', evidence.unresolvedRecordIds)
  if (evidence.unresolvedRecordIds.length > 0) add('unresolved-source', '深读引用的原文仍有缺失或模糊记录。', evidence.unresolvedRecordIds)
  for (const issue of evidence.qualityIssues ?? []) {
    add(`evidence-${issue.code}`, issue.message, issue.recordIds ?? [])
  }
  const report = readReport(branchRoot)
  if (report === undefined) {
    add('report-unavailable', '深读报告不可读。')
    return
  }
  if ([...recordsById.keys()].some((id) => report.includes(id))) add('source-id-exposed', '读者报告暴露了内部原文记录标识。')
  if (!evidence.claims.some((claim) => claim.kind === 'fact') || !evidence.claims.some((claim) => claim.kind === 'inference')) {
    add('claim-classes', '关键主张未同时区分论文事实与分析推论。')
  }
  for (const claim of evidence.claims) {
    if (!report.includes(claim.passage)) {
      add('claim-passage-missing', '证据关联的主张段落已不在当前报告中。')
      continue
    }
    const reference = claim.evidence[0]
    if (reference === undefined) {
      add('claim-evidence-invalid', '重要主张缺少原文证据。')
      continue
    }
    const stored = recordsById.get(reference.recordId)
    if (stored === undefined || stored.record.state !== 'present' || stored.record.kind === 'gap'
      || VISUAL_KINDS.has(stored.record.kind) || stored.revision !== reference.revision
      || !stored.record.text.includes(reference.quote)) {
      add('claim-evidence-invalid', '重要主张与原文证据的关联无效或已过期。', [reference.recordId])
    }
  }
  for (const asset of source.state.assets) {
    if (asset.availability !== 'available') add('asset-unavailable', '必要原文图表裁切不可用，深读结论不能标为已核实。', [asset.recordId])
    else if (!isReadablePng(join(branchRoot, '..', '..', 'assets', `${asset.id}.png`))) add('asset-damaged', '深读引用的原文裁切文件缺失或不可读。', [asset.recordId])
  }
  for (const assetId of referencedAssetIds(report)) {
    const asset = source.state.assets.find((candidate) => candidate.id === assetId)
    if (asset === undefined || asset.availability !== 'available') add('asset-unresolved', '报告引用了不可用或不属于本任务的原文裁切。')
  }
  if (source.state.status === 'incomplete') add('source-incomplete', '原文准备仍有缺失，深读成果不能标为完整。')
  if (source.state.status === 'needs-confirmation') add('source-needs-confirmation', '原文准备仍有需确认内容，深读成果不能标为完整。')
}

function numericSourceText(record: { readonly kind: string; readonly text: string }): string {
  if (record.kind === 'heading') return record.text.replace(/^\d+(?:\.\d+)*\.?\s+/u, '')
  if (record.kind === 'footnote') return record.text.replace(/^\d+\s+/u, '')
  return record.text
}

function readReport(branchRoot: string): string | undefined {
  try {
    return readFileSync(join(branchRoot, 'report.md'), 'utf8')
  } catch {
    return undefined
  }
}

function inspectReceipts(
  root: string,
  branch: PaperTaskBranch,
  source: { readonly records: readonly StoredRecord[]; readonly state: SourceState },
  add: (code: string, message: string, recordIds?: readonly string[], severity?: PaperTaskQualityIssueSeverity) => void,
): void {
  const receipts: readonly PaperTaskImageReceipt[] = readPaperTaskImageReceipts(
    root,
    source.records,
    source.state.assets.map((asset) => ({ id: asset.id, recordId: asset.recordId })),
  )
  for (const receipt of receipts) {
    if (receipt.branch !== branch) continue
    if (receipt.status === 'blocked' && receipt.reason === 'stale-source') {
      add('asset-stale', '原文修正后图表裁切已过期，需要重新准备。', [receipt.recordId])
    }
  }
}

function readReview(branchRoot: string, branch: PaperTaskBranch): {
  readonly completed: boolean
  readonly stale: boolean
  readonly artifact?: z.infer<typeof reviewArtifactSchema>
} {
  try {
    const parsed = reviewArtifactSchema.safeParse(JSON.parse(readFileSync(join(branchRoot, 'review.json'), 'utf8')))
    if (!parsed.success || parsed.data.branch !== branch) return { completed: false, stale: false }
    return { completed: true, stale: false, artifact: parsed.data }
  } catch {
    return { completed: false, stale: false }
  }
}

function referencedAssetIds(markdown: string): Set<string> {
  const found = new Set<string>()
  const prose = markdown.replace(/```[\s\S]*?```/gu, '').replace(/~~~[\s\S]*?~~~/gu, '')
  for (const match of prose.matchAll(/!\[[^\]\n]*\]\((asset:[^)\s]+)\)/gu)) {
    if (match[1] !== undefined) found.add(match[1].slice('asset:'.length))
  }
  return found
}

function isReadablePng(path: string): boolean {
  try {
    const bytes = readFileSync(path)
    return bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  } catch {
    return false
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
