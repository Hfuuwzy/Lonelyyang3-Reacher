import { createHash } from 'node:crypto'
import { inspectTranslationMaster } from './translation-master.mjs'
import { translationBlockers } from './translation-eligibility.mjs'
import { inspectDeepReadingReport } from './deep-reading-report.mjs'

export const REVIEW_CODES = ['terminology', 'number', 'omission', 'evidence', 'layout', 'other']
export const REVIEW_SEVERITIES = ['minor', 'substantive']
export const MAX_REVIEW_FINDINGS = 50
export const MAX_REPAIR_TARGETS = 60
export const MAX_REVIEW_DESCRIPTION = 500
export const MAX_REPAIR_SEGMENT_CHARS = 20000

const CONTENT_CODES = new Set(['terminology', 'number', 'omission', 'evidence', 'other'])

export function splitMarkdownParagraphs(markdown) {
  return markdownParagraphSpans(markdown).map((paragraph) => paragraph.text)
}

function markdownParagraphSpans(markdown) {
  const spans = []
  const separator = /\n\s*\n/gu
  let lastIndex = 0
  let match = separator.exec(markdown)
  while (match !== null) {
    pushParagraphSpan(spans, markdown, lastIndex, match.index)
    lastIndex = match.index + match[0].length
    match = separator.exec(markdown)
  }
  pushParagraphSpan(spans, markdown, lastIndex, markdown.length)
  return spans
}

function pushParagraphSpan(spans, markdown, start, end) {
  const raw = markdown.slice(start, end)
  const text = raw.trim()
  if (text.length === 0) return
  spans.push({ text, start: start + (raw.length - raw.trimStart().length), end: end - (raw.length - raw.trimEnd().length) })
}

export function normalizeReviewSubmission({ args, baseline, targetCount, indexedIds }) {
  if (args === null || typeof args !== 'object' || !Array.isArray(args.findings)) {
    throw new Error('content review needs a bounded findings array')
  }
  if (args.findings.length > MAX_REVIEW_FINDINGS) throw new Error('content review has too many findings')
  if (!Number.isSafeInteger(targetCount) || targetCount < 1) throw new Error('content review has no reviewable target')
  const indexed = new Set(indexedIds)
  const findings = args.findings.map((finding, position) => {
    if (finding === null || typeof finding !== 'object') {
      throw new Error('content review finding is invalid')
    }
    const code = finding.code
    const severity = finding.severity
    const description = typeof finding.description === 'string' ? finding.description.trim() : ''
    if (typeof code !== 'string' || !REVIEW_CODES.includes(code)
      || typeof severity !== 'string' || !REVIEW_SEVERITIES.includes(severity)
      || description.length === 0 || description.length > MAX_REVIEW_DESCRIPTION) {
      throw new Error('content review finding is invalid')
    }
    const targetIndexes = normalizeIndexes(finding.target_indexes, targetCount)
    const recordIds = normalizeRecordIds(finding.record_ids, indexed)
    if (severity === 'substantive' && targetIndexes.length === 0) {
      throw new Error('each substantive finding must name at least one target index')
    }
    if (severity === 'substantive' && CONTENT_CODES.has(code) && recordIds.length === 0) {
      throw new Error('each substantive content finding must cite at least one source record')
    }
    return { id: `f${position + 1}`, code, severity, description, targetIndexes, recordIds }
  })
  return { findings, baselineSha256: hashText(baseline) }
}

export function planTranslationRepair({ metadata, args, findings, context }) {
  const targets = normalizeRepairTargets(args.targets)
  const segments = metadata.segments.map((segment) => ({
    markdown: segment.markdown,
    source_record_ids: segment.dependencies.map((dependency) => dependency.recordId),
  }))
  const changedIndexes = []
  for (const target of targets) {
    if (target.index >= segments.length) throw new Error('repair target is outside the published master')
    if (!citedBySubstantive(findings, target.index)) throw new Error('repair target was not named by a substantive review finding')
    segments[target.index] = { ...segments[target.index], markdown: target.markdown }
    changedIndexes.push(target.index)
  }
  const before = inspectTranslationMaster({
    segments: metadata.segments.map((segment) => ({
      markdown: segment.markdown,
      source_record_ids: segment.dependencies.map((dependency) => dependency.recordId),
    })),
    terminology: metadata.terminology,
    unresolved: metadata.unresolved.map((item) => ({ record_id: item.recordId, reason: item.reason })),
  }, context)
  const rawArgs = {
    segments,
    terminology: args.terminology ?? metadata.terminology,
    unresolved: args.unresolved ?? metadata.unresolved.map((item) => ({ record_id: item.recordId, reason: item.reason })),
  }
  const after = inspectTranslationMaster(rawArgs, context)
  const blockers = translationBlockers({
    records: context.records,
    segments: after.metadata.segments,
    unresolved: after.metadata.unresolved,
    markdown: after.markdown,
    sourceStatus: context.state.status,
    translationStatus: after.metadata.status,
    issues: after.issues,
  })
  if (blockers.length > 0) throw new Error(`translation repair is blocked: ${blockers.join(', ')}`)
  assertNoNewIssues(before.issues, after.issues, 'repair introduces an unverified coverage or numeric change')
  const { appliedFindingIds, residualFindingIds } = resolution(findings, changedIndexes)
  return {
    markdown: after.markdown,
    metadata: after.metadata,
    issues: after.issues,
    changedIndexes: [...new Set(changedIndexes)].sort((left, right) => left - right),
    appliedFindingIds,
    residualFindingIds,
  }
}

export function planDeepReadingRepair({ report, evidence, args, findings, context }) {
  const paragraphs = markdownParagraphSpans(report)
  const targets = normalizeRepairTargets(args.targets)
  const claimPassages = evidence.claims.map((claim) => claim.passage)
  const changedIndexes = []
  for (const target of targets) {
    if (target.index >= paragraphs.length) throw new Error('repair target is outside the published report')
    if (!citedBySubstantive(findings, target.index)) throw new Error('repair target was not named by a substantive review finding')
    const paragraph = paragraphs[target.index].text
    if (claimPassages.some((passage) => paragraph.includes(passage) || passage.includes(paragraph))) {
      throw new Error('repair cannot rewrite a passage that carries claim evidence')
    }
    changedIndexes.push(target.index)
  }
  let markdown = report
  const ordered = [...targets].sort((left, right) => paragraphs[right.index].start - paragraphs[left.index].start)
  for (const target of ordered) {
    const span = paragraphs[target.index]
    markdown = markdown.slice(0, span.start) + target.markdown + markdown.slice(span.end)
  }
  const before = inspectDeepReadingReport({
    markdown: report,
    source_record_ids: [],
    claim_evidence: rawClaims(evidence),
    uncompleted_reasons: evidence.uncompletedReasons,
  }, context)
  const rawArgs = {
    markdown,
    source_record_ids: [],
    claim_evidence: rawClaims(evidence),
    uncompleted_reasons: args.uncompleted_reasons ?? evidence.uncompletedReasons,
  }
  const after = inspectDeepReadingReport(rawArgs, context)
  assertNoNewIssues(before.issues, after.issues, 'repair introduces an unverified claim or evidence association')
  const { appliedFindingIds, residualFindingIds } = resolution(findings, changedIndexes)
  return {
    markdown,
    evidence: after.evidence,
    issues: after.issues,
    changedIndexes: [...new Set(changedIndexes)].sort((left, right) => left - right),
    appliedFindingIds,
    residualFindingIds,
  }
}

export function repairReadScope(findings, records) {
  const byId = new Map(records.map((stored) => [stored.record.id, stored.record]))
  const cited = new Set(findings.filter((finding) => finding.severity === 'substantive').flatMap((finding) => finding.recordIds))
  const allowed = new Set(cited)
  for (const recordId of cited) {
    const record = byId.get(recordId)
    if (record === undefined) continue
    if (record.sectionId !== null) allowed.add(record.sectionId)
    for (const candidate of records) {
      if (Math.abs(candidate.record.order - record.order) <= 1) allowed.add(candidate.record.id)
      if (record.context !== '' && candidate.record.text === record.context) allowed.add(candidate.record.id)
      if (record.context !== '' && candidate.record.context === record.context) allowed.add(candidate.record.id)
    }
  }
  return allowed
}

function normalizeIndexes(value, targetCount) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 64) throw new Error('content review finding targets are invalid')
  const indexes = [...new Set(value)]
  if (indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= targetCount)) {
    throw new Error('content review finding target is outside the reviewed draft')
  }
  return indexes.sort((left, right) => left - right)
}

function normalizeRecordIds(value, indexed) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 64) throw new Error('content review finding records are invalid')
  const ids = [...new Set(value)]
  if (ids.some((id) => typeof id !== 'string' || !indexed.has(id))) throw new Error('content review finding names an unknown source record')
  return ids.sort()
}

function normalizeRepairTargets(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPAIR_TARGETS) {
    throw new Error('local repair needs a bounded targets array')
  }
  const seen = new Set()
  return value.map((target) => {
    if (target === null || typeof target !== 'object'
      || !Number.isSafeInteger(target.index) || target.index < 0
      || typeof target.markdown !== 'string' || target.markdown.trim().length === 0
      || target.markdown.length > MAX_REPAIR_SEGMENT_CHARS
      || seen.has(target.index)) {
      throw new Error('local repair target is invalid')
    }
    seen.add(target.index)
    return { index: target.index, markdown: target.markdown.trim() }
  })
}

function citedBySubstantive(findings, index) {
  return findings.some((finding) => finding.severity === 'substantive' && finding.targetIndexes.includes(index))
}

function resolution(findings, changedIndexes) {
  const changed = new Set(changedIndexes)
  const substantive = findings.filter((finding) => finding.severity === 'substantive')
  return {
    appliedFindingIds: substantive.filter((finding) => finding.targetIndexes.every((index) => changed.has(index))).map((finding) => finding.id),
    residualFindingIds: substantive.filter((finding) => !finding.targetIndexes.every((index) => changed.has(index))).map((finding) => finding.id),
  }
}

function assertNoNewIssues(before, after, message) {
  const known = new Set(before.map(issueKey))
  if (after.some((issue) => !known.has(issueKey(issue)))) throw new Error(message)
}

function issueKey(issue) {
  return `${issue.code}:${issue.message}:${[...issue.recordIds].sort().join(',')}`
}

function rawClaims(evidence) {
  return evidence.claims.map((claim) => ({
    passage: claim.passage,
    kind: claim.kind,
    source_record_id: claim.evidence[0].recordId,
    quote: claim.evidence[0].quote,
    ...(claim.explanation === null || claim.explanation === undefined ? {} : { explanation: claim.explanation }),
  }))
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex')
}
