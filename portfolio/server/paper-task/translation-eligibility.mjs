const TEXT_KINDS = new Set(['heading', 'body', 'appendix', 'footnote', 'figure'])
const PROSE_KINDS = new Set(['body', 'appendix', 'footnote'])
const BLOCKER_CODES = new Set([
  'covered-and-unresolved',
  'gap-translated',
  'ambiguous-translated',
  'disclosure-missing',
])
const DISCLOSURE_CUE = /待补|待确认|未完成|未核实|无法恢复|缺失|无法读取/u

export function translationBlockers({ records, segments, unresolved, markdown = '', sourceStatus, translationStatus = '', issues = [] }) {
  const blockers = new Set(issues.filter((issue) => BLOCKER_CODES.has(issue.code)).map((issue) => issue.code))
  const byId = new Map(records.map((stored) => [stored.record.id, stored.record]))
  const unresolvedIds = new Set(unresolved.map((item) => item.recordId))
  const represented = new Set()
  const measuredRecords = new Set()
  const charactersByRecord = new Map()
  const references = records.filter((stored) => stored.record.kind === 'reference')
    .map((stored) => stored.record.text.replace(/\s+/gu, '')).filter(Boolean)
  let translatedCharacters = 0

  for (const segment of segments) {
    const textRecords = segment.dependencies
      .map((dependency) => byId.get(dependency.recordId))
      .filter((record) => record !== undefined && TEXT_KINDS.has(record.kind))
    for (const record of textRecords) represented.add(record.id)
    const stale = translationStatus === 'needs-update' && segment.stale === true
    const expectedRecords = textRecords.filter((record) => record.state === 'present' && !unresolvedIds.has(record.id) && !stale)
    if (expectedRecords.length > 0) {
      let prose = proseText(segment.markdown).replace(/\s+/gu, '')
      for (const reference of references) prose = prose.replaceAll(reference, '')
      const characters = letterCount(prose)
      translatedCharacters += characters
      for (const record of expectedRecords) {
        measuredRecords.add(record.id)
        charactersByRecord.set(record.id, (charactersByRecord.get(record.id) ?? 0) + characters)
      }
    }
    for (const dependency of segment.dependencies) {
      const record = byId.get(dependency.recordId)
      if (!stale && record?.kind === 'gap') blockers.add('gap-translated')
      if (!stale && record !== undefined && record.state !== 'present' && record.kind !== 'gap') blockers.add('ambiguous-translated')
    }
  }

  const presentText = records.filter((stored) => stored.record.state === 'present' && TEXT_KINDS.has(stored.record.kind))
  for (const stored of presentText) {
    const id = stored.record.id
    const isCovered = represented.has(id)
    if (!isCovered && !unresolvedIds.has(id)) blockers.add('record-uncovered')
    if (isCovered && unresolvedIds.has(id)) blockers.add('covered-and-unresolved')
  }

  const translatedSource = presentText
    .filter((stored) => represented.has(stored.record.id) && !unresolvedIds.has(stored.record.id))
  const sourceHasProse = presentText.some((stored) => PROSE_KINDS.has(stored.record.kind))
  if ((sourceHasProse && !translatedSource.some((stored) => PROSE_KINDS.has(stored.record.kind)))
    || (presentText.length > 0 && translatedSource.length === 0)) blockers.add('translation-no-prose')
  const readerText = markdown || segments.map((segment) => segment.markdown).join('\n\n')
  if ((unresolved.length > 0 || translationStatus === 'incomplete'
    || (translationStatus !== 'needs-update' && sourceStatus !== undefined && sourceStatus !== 'complete'))
    && !DISCLOSURE_CUE.test(readerText)) {
    blockers.add('disclosure-missing')
  }

  let sourceCharacters = 0
  for (const id of measuredRecords) {
    const expectedCharacters = letterCount(byId.get(id).text)
    sourceCharacters += expectedCharacters
    if ((charactersByRecord.get(id) ?? 0) < expectedCharacters * 0.25) blockers.add('master-too-short')
  }
  if (translatedCharacters < sourceCharacters * 0.25) blockers.add('master-too-short')

  return [...blockers]
}

function proseText(markdown) {
  return markdown
    .replace(/!\[[^\]\n]*\]\([^)\s]+\)/gu, '')
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/~~~[\s\S]*?~~~/gu, '')
    .replace(/https?:\/\/[^\s)]+/gu, '')
}

function letterCount(text) {
  return (text.match(/\p{L}/gu) ?? []).length
}
