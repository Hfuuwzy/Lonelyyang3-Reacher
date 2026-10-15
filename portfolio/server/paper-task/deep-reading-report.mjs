import { createHash } from 'node:crypto'

const FACT_CUE = /\bfact\b|\b(?:paper|authors?|study)\s+(?:reports?|states?|finds?|found)\b|事实|论文(?:陈述|报告|指出)|作者(?:报告|指出)/iu
const INFERENCE_CUE = /\binference\b|\b(?:we infer|our interpretation)\b|推论|推断|分析认为/iu
const CONFIRMATION_CUE = /confirmation|uncompleted|not verified|unverified|incomplete|待确认|需确认|确认事项|未完成|未经验证|尚未核实/iu

export function validateDeepReadingReport(args, source) {
  const { markdown, claim_evidence: claims, uncompleted_reasons: reasons = [] } = args
  if (!Array.isArray(claims) || claims.length === 0 || claims.length > 256
    || Buffer.byteLength(JSON.stringify(claims), 'utf8') > 200000) throw new Error('deep-reading report needs bounded claim evidence')
  if (!Array.isArray(reasons) || reasons.length > 100
    || reasons.some((reason) => typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 2000)) throw new Error('deep-reading uncompleted reasons are invalid')
  const byId = new Map(source.records.map((stored) => [stored.record.id, stored]))
  if ([...byId.keys()].some((id) => markdown.includes(id))) throw new Error('reader report must not expose source record identifiers')
  const evidenceClaims = claims.map((claim) => {
    if (claim === null || typeof claim !== 'object' || typeof claim.passage !== 'string'
      || claim.passage.trim().length === 0 || !markdown.includes(claim.passage)
      || !['fact', 'inference'].includes(claim.kind)
      || typeof claim.quote !== 'string' || claim.quote.trim().length === 0) throw new Error('deep-reading claim evidence is invalid or missing')
    const stored = byId.get(claim.source_record_id)
    if (stored === undefined) throw new Error('claim names an unknown source record')
    if (stored.record.kind === 'gap') throw new Error('gap records cannot support verified claims')
    if (stored.record.state !== 'present') throw new Error('ambiguous or missing records cannot support verified claims')
    if (['table', 'formula', 'algorithm'].includes(stored.record.kind)) throw new Error('visual-only tables, formulas, and algorithms cannot be verified evidence')
    if (!stored.record.text.includes(claim.quote)) throw new Error('claim quote does not match the cited source revision')
    const inferenceCue = INFERENCE_CUE.test(claim.passage)
    if (claim.kind === 'fact' ? !FACT_CUE.test(claim.passage) || inferenceCue : !inferenceCue) throw new Error('report passage classification does not match its reader-visible wording')
    if (claim.kind === 'inference' && (typeof claim.explanation !== 'string' || claim.explanation.trim().length === 0 || claim.explanation.length > 4000)) throw new Error('inference evidence needs a bounded explanation')
    return {
      passage: claim.passage, kind: claim.kind, explanation: claim.explanation ?? null,
      evidence: [{ recordId: stored.record.id, revision: stored.revision, quote: claim.quote }],
    }
  })
  if (!evidenceClaims.some((claim) => claim.kind === 'fact') || !evidenceClaims.some((claim) => claim.kind === 'inference')) throw new Error('claim evidence must distinguish fact passages from inference passages')
  const assets = source.state.assets
  if (!Array.isArray(assets) || assets.some((asset) => asset === null || typeof asset !== 'object'
    || typeof asset.id !== 'string' || !/^asset-[a-z0-9]+$/u.test(asset.id) || !byId.has(asset.recordId)
    || asset.understanding !== 'unverified' || !['available', 'unavailable'].includes(asset.availability)
    || asset.relativePath !== (asset.availability === 'available' ? `../../assets/${asset.id}.png` : null))) throw new Error('source asset context is invalid')
  const unresolvedRecordIds = source.records.filter(({ record }) => record.kind === 'gap' || record.state !== 'present').map(({ record }) => record.id)
  const hasUncompletedMaterial = assets.length > 0 || source.state.status !== 'complete' || unresolvedRecordIds.length > 0
  if ((hasUncompletedMaterial || reasons.length > 0) && (!CONFIRMATION_CUE.test(markdown) || reasons.length === 0)) throw new Error('report must disclose unverified source material and retain its reason')
  return {
    manuscriptSha256: createHash('sha256').update(markdown).digest('hex'),
    status: hasUncompletedMaterial || reasons.length > 0 ? 'needs-confirmation' : 'preview',
    claims: evidenceClaims, assets, uncompletedReasons: reasons,
    unverifiedAssetIds: assets.map((asset) => asset.id), unresolvedRecordIds,
  }
}
