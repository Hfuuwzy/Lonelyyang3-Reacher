import { createHash } from 'node:crypto'

const FACT_CUE = /\bfact\b|\b(?:paper|authors?|study)\s+(?:reports?|states?|finds?|found)\b|事实|论文(?:陈述|报告|指出)|作者(?:报告|指出)/iu
const INFERENCE_CUE = /\binference\b|\b(?:we infer|our interpretation)\b|推论|推断|分析认为/iu
const CONFIRMATION_CUE = /confirmation|uncompleted|not verified|unverified|incomplete|待确认|需确认|确认事项|未完成|未经验证|尚未核实/iu
const VISUAL_KINDS = new Set(['table', 'formula', 'algorithm'])

export function hasChineseProse(markdown) {
  return typeof markdown === 'string' && (markdown.match(/[\u3400-\u9fff]/gu)?.length ?? 0) >= 20
}

export function inspectDeepReadingReport(args, source) {
  const issues = []
  const addIssue = (code, message, recordIds = []) => {
    issues.push({ code, message, severity: 'substantive', recordIds: [...new Set(recordIds)] })
  }
  const { markdown, claim_evidence: claims, uncompleted_reasons: reasons = [] } = args
  if (!Array.isArray(claims) || claims.length === 0 || claims.length > 256
    || Buffer.byteLength(JSON.stringify(claims), 'utf8') > 200000) throw new Error('deep-reading report needs bounded claim evidence')
  if (!Array.isArray(reasons) || reasons.length > 100
    || reasons.some((reason) => typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 2000)) throw new Error('deep-reading uncompleted reasons are invalid')
  const byId = new Map(source.records.map((stored) => [stored.record.id, stored]))
  if ([...byId.keys()].some((id) => markdown.includes(id))) addIssue('source-id-exposed', 'reader report must not expose source record identifiers')
  if (!hasChineseProse(markdown)) addIssue('report-language', 'deep-reading report must use Simplified Chinese for reader-facing prose')
  const evidenceClaims = []
  for (const claim of claims) {
    if (claim === null || typeof claim !== 'object' || typeof claim.passage !== 'string'
      || claim.passage.trim().length === 0 || !markdown.includes(claim.passage)
      || !['fact', 'inference'].includes(claim.kind)
      || typeof claim.quote !== 'string' || claim.quote.trim().length === 0) {
      addIssue('claim-invalid', 'deep-reading claim evidence is invalid or missing')
      continue
    }
    const stored = byId.get(claim.source_record_id)
    if (stored === undefined) {
      addIssue('claim-unknown-record', 'claim names an unknown source record')
      continue
    }
    if (stored.record.kind === 'gap') {
      addIssue('claim-gap', 'gap records cannot support verified claims', [stored.record.id])
      continue
    }
    if (stored.record.state !== 'present') {
      addIssue('claim-ambiguous', 'ambiguous or missing records cannot support verified claims', [stored.record.id])
      continue
    }
    if (VISUAL_KINDS.has(stored.record.kind)) {
      addIssue('claim-visual', 'visual-only tables, formulas, and algorithms cannot be verified evidence', [stored.record.id])
      continue
    }
    if (!stored.record.text.includes(claim.quote)) {
      addIssue('claim-quote', 'claim quote does not match the cited source revision', [stored.record.id])
      continue
    }
    const inferenceCue = INFERENCE_CUE.test(claim.passage)
    if (claim.kind === 'fact' ? !FACT_CUE.test(claim.passage) || inferenceCue : !inferenceCue) {
      addIssue('claim-classification', 'report passage classification does not match its reader-visible wording', [stored.record.id])
      continue
    }
    if (claim.kind === 'inference' && (typeof claim.explanation !== 'string' || claim.explanation.trim().length === 0 || claim.explanation.length > 4000)) {
      addIssue('claim-explanation', 'inference evidence needs a bounded explanation', [stored.record.id])
      continue
    }
    evidenceClaims.push({
      passage: claim.passage, kind: claim.kind, explanation: claim.explanation ?? null,
      evidence: [{ recordId: stored.record.id, revision: stored.revision, quote: claim.quote }],
    })
  }
  if (!evidenceClaims.some((claim) => claim.kind === 'fact') || !evidenceClaims.some((claim) => claim.kind === 'inference')) {
    addIssue('claim-classes', 'claim evidence must distinguish fact passages from inference passages')
  }
  const assets = source.state.assets
  if (!Array.isArray(assets) || assets.some((asset) => asset === null || typeof asset !== 'object'
    || typeof asset.id !== 'string' || !/^asset-[a-z0-9]+$/u.test(asset.id) || !byId.has(asset.recordId)
    || asset.understanding !== 'unverified' || !['available', 'unavailable'].includes(asset.availability)
    || asset.relativePath !== (asset.availability === 'available' ? `../../assets/${asset.id}.png` : null))) throw new Error('source asset context is invalid')
  const unresolvedRecordIds = source.records.filter(({ record }) => record.kind === 'gap' || record.state !== 'present').map(({ record }) => record.id)
  const hasUncompletedMaterial = assets.length > 0 || source.state.status !== 'complete' || unresolvedRecordIds.length > 0
  if ((hasUncompletedMaterial || reasons.length > 0) && (!CONFIRMATION_CUE.test(markdown) || reasons.length === 0)) {
    addIssue('disclosure-missing', 'report must disclose unverified source material and retain its reason', unresolvedRecordIds)
  }
  return {
    evidence: {
      manuscriptSha256: createHash('sha256').update(markdown).digest('hex'),
      status: hasUncompletedMaterial || reasons.length > 0 || issues.length > 0 ? 'needs-confirmation' : 'preview',
      claims: evidenceClaims, assets, uncompletedReasons: reasons,
      unverifiedAssetIds: assets.map((asset) => asset.id), unresolvedRecordIds,
      qualityIssues: issues,
    },
    issues,
  }
}

export function validateDeepReadingReport(args, source) {
  const result = inspectDeepReadingReport(args, source)
  const first = result.issues[0]
  if (first !== undefined) throw new Error(first.message)
  return result.evidence
}
