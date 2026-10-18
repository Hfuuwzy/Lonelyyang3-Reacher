import { createHash } from 'node:crypto'

/**
 * Validation for the natural Chinese translation master (issue #46).
 *
 * The model writes natural paragraphs, not a fixed article schema and not a
 * line-by-line alignment. The application still needs a truthful coverage
 * ledger: every indexed source record must be translated, preserved as an
 * original asset, kept as an English reference entry, or declared unresolved
 * with a short actionable reason.
 *
 * `inspectTranslationMaster` separates unsafe input (which throws) from
 * quality findings (which are returned). The strict wrapper throws the first
 * finding so existing publication callers keep their fail-closed behavior.
 *
 * These checks are structural and presence-based. They are not proof of
 * sentence-level accuracy or translation quality.
 */

const MAX_SEGMENTS = 400
const MAX_MARKDOWN_BYTES = 400_000
const MAX_SEGMENT_CHARS = 20_000
const MAX_RECORDS_PER_SEGMENT = 60
const MAX_TERMS = 60
const MAX_UNRESOLVED = 500
const ASSET_ID_PATTERN = /^asset-[0-9a-z]+$/
const ASSET_LINK_PATTERN = /!\[[^\]\n]*\]\((asset:[^)\s]+)\)/gu
const ANY_IMAGE_PATTERN = /!\[[^\]\n]*\]\(([^)\s]+)/gu
const REFERENCE_KINDS = new Set(['reference'])
const VISUAL_KINDS = new Set(['table', 'formula', 'algorithm'])
const TEXT_KINDS = new Set(['heading', 'body', 'appendix', 'footnote', 'figure'])
const DISCLOSURE_CUE = /待补|待确认|未完成|未核实|无法恢复|缺失|无法读取/u

export function inspectTranslationMaster(args, context) {
  const { records, state, indexIds, sourceRevision } = context
  const byId = new Map(records.map((stored) => [stored.record.id, stored]))
  const indexed = new Set(indexIds)
  const issues = []
  const addIssue = (code, message, recordIds = []) => {
    issues.push({ code, message, severity: 'substantive', recordIds: [...new Set(recordIds)] })
  }
  if (!Array.isArray(args.segments) || args.segments.length < 1 || args.segments.length > MAX_SEGMENTS) {
    throw new Error('translation needs bounded natural segments')
  }

  const segments = []
  const coveredIds = new Set()
  const referencedAssetIds = new Set()
  let markdown = ''
  for (const [index, segment] of args.segments.entries()) {
    if (segment === null || typeof segment !== 'object' || typeof segment.markdown !== 'string') {
      throw new Error('translation segment is invalid')
    }
    const text = segment.markdown.trim()
    if (text.length === 0 || text.length > MAX_SEGMENT_CHARS) throw new Error('translation segment is empty or oversized')
    if (!Array.isArray(segment.source_record_ids) || segment.source_record_ids.length > MAX_RECORDS_PER_SEGMENT) {
      throw new Error('translation segment dependencies are invalid')
    }
    const recordIds = [...new Set(segment.source_record_ids)]
    if (recordIds.length !== segment.source_record_ids.length
      || recordIds.some((id) => typeof id !== 'string' || !indexed.has(id))) {
      throw new Error('translation segment names unknown or duplicate source records')
    }
    for (const assetId of assetIdsIn(text)) {
      const asset = state.assets.find((candidate) => candidate.id === assetId)
      if (asset === undefined || asset.availability !== 'available' || !indexed.has(asset.recordId)) {
        addIssue('asset-invalid', 'translation references an unavailable or foreign asset', asset === undefined ? [] : [asset.recordId])
        continue
      }
      referencedAssetIds.add(assetId)
      if (!recordIds.includes(asset.recordId)) recordIds.push(asset.recordId)
    }
    const dependencies = recordIds.map((recordId) => {
      const stored = byId.get(recordId)
      if (stored === undefined) throw new Error('translation segment source record is unavailable')
      return { recordId, revision: stored.revision }
    })
    for (const recordId of recordIds) {
      const record = byId.get(recordId)?.record
      if (record === undefined) throw new Error('translation segment source record is unavailable')
      if (record.kind === 'gap') {
        addIssue('gap-translated', 'unrecoverable source records cannot be translated', [recordId])
        continue
      }
      if (record.state !== 'present') {
        addIssue('ambiguous-translated', 'ambiguous or missing source records need an unresolved reason', [recordId])
        continue
      }
      if (REFERENCE_KINDS.has(record.kind) && !includesNormalized(text, record.text)) {
        addIssue('reference-translated', 'reference entries must keep their original English text', [recordId])
      }
    }
    markdown += `${markdown === '' ? '' : '\n\n'}${text}`
    for (const recordId of recordIds) coveredIds.add(recordId)
    segments.push({ index, markdown: text, stale: false, dependencies })
  }
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('translation master exceeds the allowed size')

  const unresolved = parseUnresolved(args.unresolved, indexed)
  const unresolvedIds = new Set(unresolved.map((item) => item.recordId))
  for (const recordId of unresolvedIds) {
    const record = byId.get(recordId)?.record
    if (coveredIds.has(recordId)) addIssue('covered-and-unresolved', 'a source record cannot be both translated and unresolved', [recordId])
    if (record?.kind === 'reference' && record.state === 'present') {
      addIssue('reference-unresolved', 'present reference entries must be preserved, not marked unresolved', [recordId])
    }
  }
  for (const stored of records) {
    const record = stored.record
    if (unresolvedIds.has(record.id)) continue
    if (record.kind === 'gap') {
      addIssue('gap-unresolved', 'unrecoverable source records need an unresolved reason', [record.id])
      continue
    }
    if (record.kind === 'figure') {
      const asset = state.assets.find((candidate) => candidate.recordId === record.id)
      if (asset?.availability === 'available' && !referencedAssetIds.has(asset.id)) {
        addIssue('figure-unreferenced', 'every retained figure needs its original asset in the master', [record.id])
      }
    }
    if (VISUAL_KINDS.has(record.kind)) {
      const asset = state.assets.find((candidate) => candidate.recordId === record.id)
      if (asset === undefined || asset.availability !== 'available' || !referencedAssetIds.has(asset.id)) {
        addIssue('visual-unreferenced', 'every visual source record needs its original asset or an unresolved reason', [record.id])
      }
    }
  }
  for (const asset of state.assets) {
    if (asset.availability !== 'available' && !unresolvedIds.has(asset.recordId)) {
      addIssue('asset-unavailable', 'a source asset is unavailable; the corresponding material must be declared unresolved', [asset.recordId])
    }
  }
  for (const id of indexed) {
    if (!coveredIds.has(id) && !unresolvedIds.has(id)) {
      addIssue('record-uncovered', 'every indexed source record must be translated, preserved, or marked unresolved', [id])
    }
  }

  verifyNumericPreservation(byId, segments, addIssue)
  verifySourceFullness(byId, coveredIds, markdown, addIssue)
  const terminology = inspectTerminology(args.terminology, byId, markdown, addIssue)
  const assets = state.assets
    .filter((asset) => referencedAssetIds.has(asset.id))
    .map((asset) => ({
      id: asset.id,
      recordId: asset.recordId,
      kind: byId.get(asset.recordId)?.record.kind ?? 'table',
      caption: assetCaption(byId.get(asset.recordId)?.record),
      availability: asset.availability,
    }))
  const status = unresolved.length > 0 || state.status !== 'complete' || issues.length > 0 ? 'incomplete' : 'complete'
  if (status === 'incomplete' && !DISCLOSURE_CUE.test(markdown)) {
    addIssue('disclosure-missing', 'incomplete translation must disclose what needs confirmation in the reader text')
  }

  return {
    markdown,
    metadata: {
      version: 1,
      status,
      sourceRevision,
      masterSha256: createHash('sha256').update(markdown).digest('hex'),
      segments,
      terminology,
      unresolved,
      assets,
    },
    issues,
  }
}

export function validateTranslationMaster(args, context) {
  const result = inspectTranslationMaster(args, context)
  const first = result.issues[0]
  if (first !== undefined) throw new Error(first.message)
  return { markdown: result.markdown, metadata: result.metadata }
}

function assetIdsIn(markdown) {
  const found = new Set()
  const prose = markdown.replace(/```[\s\S]*?```/gu, '').replace(/~~~[\s\S]*?~~~/gu, '')
  for (const match of prose.matchAll(ANY_IMAGE_PATTERN)) {
    const target = match[1]
    if (!target.startsWith('asset:')) throw new Error('translation images must use controlled original assets')
  }
  for (const match of prose.matchAll(ASSET_LINK_PATTERN)) {
    const assetId = match[1].slice('asset:'.length)
    if (!ASSET_ID_PATTERN.test(assetId)) throw new Error('translation asset reference is invalid')
    found.add(assetId)
  }
  return found
}

function parseUnresolved(value, indexed) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_UNRESOLVED) throw new Error('translation unresolved list is invalid')
  const seen = new Set()
  return value.map((item) => {
    if (item === null || typeof item !== 'object'
      || typeof item.record_id !== 'string' || !indexed.has(item.record_id)
      || typeof item.reason !== 'string' || item.reason.trim().length === 0 || item.reason.length > 500
      || seen.has(item.record_id)) {
      throw new Error('translation unresolved entry is invalid')
    }
    seen.add(item.record_id)
    return { recordId: item.record_id, reason: item.reason.trim() }
  })
}

function inspectTerminology(value, byId, markdown, addIssue) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_TERMS) {
    addIssue('terminology-invalid', 'translation terminology is invalid')
    return []
  }
  const seen = new Set()
  const compact = markdown.replace(/\s+/gu, '')
  const terms = []
  for (const item of value) {
    if (item === null || typeof item !== 'object'
      || typeof item.source !== 'string' || item.source.trim().length === 0 || item.source.length > 120
      || typeof item.target !== 'string' || item.target.trim().length === 0 || item.target.length > 120
      || seen.has(item.source.trim())) {
      addIssue('terminology-invalid', 'translation terminology entry is invalid or duplicated')
      continue
    }
    const source = item.source.trim()
    const target = item.target.trim()
    const appearsInSource = [...byId.values()].some((stored) =>
      TEXT_KINDS.has(stored.record.kind) && normalized(stored.record.text).includes(normalized(source)),
    )
    if (!appearsInSource || !compact.includes(target.replace(/\s+/gu, ''))) {
      addIssue('terminology-ungrounded', 'translation terminology is not grounded in the source and master')
      continue
    }
    seen.add(source)
    terms.push({ source, target })
  }
  return terms
}

function assetCaption(record) {
  const firstLine = record.text.trim().split('\n')[0]?.trim() ?? ''
  return (firstLine || `原文${record.kind}`).slice(0, 500)
}

function verifyNumericPreservation(byId, segments, addIssue) {
  const byRecord = new Map()
  for (const segment of segments) {
    for (const dependency of segment.dependencies) {
      const texts = byRecord.get(dependency.recordId) ?? []
      texts.push(segment.markdown.replace(/\s+/gu, ''))
      byRecord.set(dependency.recordId, texts)
    }
  }
  for (const [recordId, compactSegments] of byRecord) {
    const record = byId.get(recordId)?.record
    if (record === undefined || !TEXT_KINDS.has(record.kind)) continue
    for (const match of numericSourceText(record).matchAll(/\d+(?:[.,]\d+)*\s*%?/gu)) {
      const token = match[0].replace(/\s+/gu, '')
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const pattern = new RegExp(`(?:^|[^\\d.,])${escaped}(?![\\d.,])`, 'u')
      if (!compactSegments.some((text) => pattern.test(text))) {
        addIssue('number-mismatch', 'translation dropped or changed a source number or unit', [recordId])
      }
    }
  }
}

function numericSourceText(record) {
  if (record.kind === 'heading') return record.text.replace(/^\d+(?:\.\d+)*\.?\s+/u, '')
  if (record.kind === 'footnote') return record.text.replace(/^\d+\s+/u, '')
  return record.text
}

function verifySourceFullness(byId, coveredIds, markdown, addIssue) {
  let sourceCharacters = 0
  for (const recordId of coveredIds) {
    const record = byId.get(recordId)?.record
    if (record !== undefined && TEXT_KINDS.has(record.kind)) sourceCharacters += record.text.replace(/\s+/gu, '').length
  }
  if (sourceCharacters < 200) return
  const masterCharacters = markdown.replace(/\s+/gu, '').length
  if (masterCharacters < sourceCharacters * 0.25) {
    addIssue('master-too-short', 'translation master is too short to cover the translated source text')
  }
}

function includesNormalized(haystack, needle) {
  return normalized(haystack).includes(normalized(needle))
}

function normalized(value) {
  return value.replace(/\s+/gu, ' ').trim()
}
