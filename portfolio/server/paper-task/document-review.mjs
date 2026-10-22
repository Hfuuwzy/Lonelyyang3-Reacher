import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeOwnedFile } from './controlled-files.mjs'
import { readSourceDocument, sourceHash } from './source-document.mjs'
import { loadSkillSnapshot } from './skill-resources.mjs'
import { readDocumentArtifact, validateDocumentMarkdown, writeDocumentArtifact } from './document-artifact.mjs'

const findingSchema = z.object({
  id: z.string(), code: z.enum(['terminology', 'number', 'omission', 'evidence', 'layout', 'other']),
  severity: z.enum(['minor', 'substantive']), description: z.string().min(1).max(1000),
  targetIndexes: z.array(z.number().int().nonnegative()).max(60), sourcePages: z.array(z.number().int().positive()).max(100),
})
const reviewSchema = z.object({
  version: z.literal(2), branch: z.enum(['translation', 'deep-reading']),
  baselineSha256: z.string(), sourceFingerprint: z.string(), skillDigest: z.string(),
  criteria: z.array(z.object({ criterion: z.string().min(1).max(1000), verdict: z.enum(['satisfied', 'limitation', 'issue']), notes: z.string().min(1).max(2000) })).min(1).max(30),
  assessment: z.string().min(1).max(6000), findings: z.array(findingSchema).max(50),
  repair: z.object({
    attempted: z.literal(true), appliedFindingIds: z.array(z.string()), residualFindingIds: z.array(z.string()),
    changedTargets: z.array(z.number().int().nonnegative()), repairedSha256: z.string(), error: z.string().optional(),
  }).nullable(),
})

export function manuscriptParagraphs(markdown) {
  const spans = []
  const separators = /\n\s*\n/gu
  let previous = 0, match
  const add = (start, end) => {
    const raw = markdown.slice(start, end)
    if (raw.trim().length > 0) spans.push({ start: start + raw.length - raw.trimStart().length, end: end - (raw.length - raw.trimEnd().length), text: raw.trim() })
  }
  while ((match = separators.exec(markdown)) !== null) { add(previous, match.index); previous = separators.lastIndex }
  add(previous, markdown.length)
  return spans
}

export async function submitDocumentReview({ root, branch, publication, args }) {
  const path = join(root, 'drafts', branch, 'review.json')
  if (existsSync(path)) throw new Error('content review was already submitted')
  const paragraphs = manuscriptParagraphs(publication.markdown)
  const pageCount = publication.source?.metadata.pageCount
  const findings = (Array.isArray(args.findings) ? args.findings : []).map((finding, index) => findingSchema.parse({
    id: `f${index + 1}`, code: finding.code, severity: finding.severity, description: finding.description,
    targetIndexes: finding.target_indexes ?? [], sourcePages: finding.source_pages ?? [],
  }))
  if (!Array.isArray(args.findings) || findings.some(finding => finding.targetIndexes.some(index => index >= paragraphs.length)
    || finding.sourcePages.some(page => pageCount !== undefined && page > pageCount)
    || (finding.severity === 'substantive' && finding.targetIndexes.length === 0))) throw new Error('review findings must identify valid manuscript paragraphs and source pages')
  const review = reviewSchema.parse({
    version: 2, branch, baselineSha256: publication.metadata.manuscriptSha256,
    sourceFingerprint: publication.metadata.source.fingerprint, skillDigest: publication.metadata.skill.digest,
    criteria: args.criteria, assessment: args.assessment, findings, repair: null,
  })
  await writeOwnedFile(join(root, 'drafts', branch), 'review.json', JSON.stringify(review))
  return review
}

export async function repairDocumentArtifact({ root, branch, publication, review, args }) {
  if (review.repair !== null) throw new Error('local repair was already attempted')
  const original = publication
  const spans = manuscriptParagraphs(publication.markdown)
  const substantive = review.findings.filter(finding => finding.severity === 'substantive')
  const permitted = new Set(substantive.flatMap(finding => finding.targetIndexes))
  const path = join(root, 'drafts', branch)
  try {
    const current = readDocumentArtifact(root, branch)
    const currentSource = readSourceDocument(root)
    const currentSkill = loadSkillSnapshot(join(root, 'generation-resources'), branch)
    const persistedReview = readDocumentReview(root, branch)
    if (current.kind !== 'document' || current.metadata.manuscriptSha256 !== publication.metadata.manuscriptSha256
      || currentSource.metadata.fingerprint !== publication.metadata.source.fingerprint
      || currentSkill.digest !== publication.metadata.skill.digest
      || review.baselineSha256 !== publication.metadata.manuscriptSha256
      || review.sourceFingerprint !== publication.metadata.source.fingerprint
      || review.skillDigest !== publication.metadata.skill.digest
      || persistedReview?.baselineSha256 !== review.baselineSha256
      || persistedReview?.sourceFingerprint !== review.sourceFingerprint
      || persistedReview?.skillDigest !== review.skillDigest) throw new Error('repair baseline or current source/skill identity changed')
    const targets = z.array(z.object({ index: z.number().int().nonnegative(), markdown: z.string().min(1).max(20000) }).strict()).min(1).max(60).parse(args.targets)
    if (new Set(targets.map(target => target.index)).size !== targets.length || targets.some(target => !permitted.has(target.index) || target.index >= spans.length)) throw new Error('repair can only change reviewed manuscript paragraphs')
    const resolutions = z.array(z.object({ finding_id: z.string(), resolved: z.boolean(), explanation: z.string().min(1).max(2000) }).strict()).max(50).parse(args.resolutions ?? [])
    if (new Set(resolutions.map(item => item.finding_id)).size !== resolutions.length) throw new Error('repair resolutions must identify each finding once')
    const changed = new Set(targets.map(target => target.index))
    if (resolutions.some(item => !substantive.some(finding => finding.id === item.finding_id)
      || (item.resolved && !substantive.find(finding => finding.id === item.finding_id).targetIndexes.every(index => changed.has(index))))) throw new Error('repair resolution must refer to changed targets of an existing finding')
    let markdown = publication.markdown
    for (const target of [...targets].sort((left, right) => right.index - left.index)) {
      const span = spans[target.index]
      markdown = markdown.slice(0, span.start) + target.markdown + markdown.slice(span.end)
    }
    const source = publication.source
    if (source === undefined) throw new Error('repair source snapshot is unavailable')
    const referencedAssets = validateDocumentMarkdown({ branch, markdown, source })
    const limitations = args.limitations ?? publication.metadata.limitations
    const repaired = await writeDocumentArtifact({ root, branch, markdown, metadata: {
      ...publication.metadata, manuscriptSha256: sourceHash(markdown), limitations, referencedAssets,
    } })
    const applied = resolutions.filter(item => item.resolved).map(item => item.finding_id)
    const next = reviewSchema.parse({ ...review, repair: {
      attempted: true, appliedFindingIds: applied,
      residualFindingIds: substantive.map(finding => finding.id).filter(id => !applied.includes(id)),
      changedTargets: [...changed], repairedSha256: repaired.metadata.manuscriptSha256,
    } })
    await writeOwnedFile(path, 'review.json', JSON.stringify(next))
    return { publication: { ...publication, ...repaired }, review: next }
  } catch (error) {
    await writeDocumentArtifact({ root, branch, markdown: original.markdown, metadata: original.metadata })
    const rejected = { ...review, repair: {
      attempted: true, appliedFindingIds: [], residualFindingIds: substantive.map(finding => finding.id),
      changedTargets: [], repairedSha256: original.metadata.manuscriptSha256, error: 'repair-rejected',
    } }
    await writeOwnedFile(path, 'review.json', JSON.stringify(rejected))
    throw error
  }
}

export function readDocumentReview(root, branch) {
  try {
    const path = join(root, 'drafts', branch, 'review.json')
    if (!existsSync(path)) return undefined
    return reviewSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

/** @returns {import('./branch-quality.ts').PaperTaskBranchQuality} */
export function evaluateDocumentQuality(root, branch, document = readDocumentArtifact(root, branch)) {
  /** @type {import('./branch-quality.ts').PaperTaskQualityIssue[]} */
  const issues = []
  const add = (code, message, minor = false) => issues.push({ code, message, severity: minor ? 'minor' : 'substantive', recordIds: [] })
  if (document.kind !== 'document') return { status: 'failed', issues: [{ code: 'document-invalid', message: '文档成品或来源校验失败。', severity: 'substantive', recordIds: [] }], options: [], reviewCompleted: false }
  if (document.stale) add('source-stale', '原文已修正；这份整稿基于旧版原文，需重新分析或翻译。')
  if (document.source.metadata.sourceStatus !== 'complete') add('source-unverified', '原文提取仍有缺失或阅读顺序疑点，请核对原论文。')
  for (const reason of document.metadata.limitations) add('declared-limitation', reason)
  if (documentAssetsUnverified(document)) add('visual-unverified', '报告引用的原始图表尚未完成独立视觉核验。')
  const review = readDocumentReview(root, branch)
  const reviewedHash = review?.repair?.error === undefined && review?.repair !== null && review?.repair !== undefined ? review.repair.repairedSha256 : review?.baselineSha256
  const reviewCompleted = review !== undefined && review.branch === branch
    && review.sourceFingerprint === document.metadata.source.fingerprint && review.skillDigest === document.metadata.skill.digest
    && reviewedHash === document.metadata.manuscriptSha256
  if (!reviewCompleted) add('review-incomplete', '尚无与当前原文、skill 和报告版本一致的内容审阅。', true)
  if (reviewCompleted) {
    const applied = new Set(review.repair?.error === undefined ? review.repair?.appliedFindingIds ?? [] : [])
    for (const finding of review.findings) if (finding.severity === 'substantive' && !applied.has(finding.id)) add(`review-${finding.code}`, finding.description)
    for (const criterion of review.criteria) if (criterion.verdict !== 'satisfied') add('skill-criterion', `${criterion.criterion}：${criterion.notes}`)
  }
  const needsConfirmation = issues.some(issue => issue.severity === 'substantive')
  return { status: needsConfirmation ? 'needs-confirmation' : 'preview', issues, options: needsConfirmation ? ['keep-readable', 'inspect-source', 'regenerate'] : ['regenerate', 'inspect-source'], reviewCompleted }
}

function documentAssetsUnverified(document) {
  return document.source.metadata.assets.some(asset => document.metadata.referencedAssets.includes(asset.id) && asset.understanding === 'unverified')
}
