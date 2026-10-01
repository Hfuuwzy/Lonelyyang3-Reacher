import type { PaperSourceInventory, PaperTranslationPair, PaperReviewTaskGap } from '../../../app/utils/paper-review-task-contract'
import { isTranslationEligible } from '../../../app/utils/paper-review-task-contract'
import { z } from 'zod'
import { parseModelJson } from './model-json'
import { unitGap } from './source-ledger'

const recordSchema = z.object({ unitId: z.string().min(1), chinese: z.string() }).strict()

export function artifactGap(artifact: PaperReviewTaskGap['artifact'], code: string): PaperReviewTaskGap {
  return { artifact, code, origin: 'application', unitIds: [], readerPages: [], spans: [], reason: `${artifact}: ${code}` }
}

export function validateTranslations(source: PaperSourceInventory, raw: string): {
  readonly pairs: readonly PaperTranslationPair[]
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const decoded = z.array(z.unknown()).safeParse(parseModelJson(raw))
  const gaps: PaperReviewTaskGap[] = []
  if (!decoded.success) gaps.push(artifactGap('translation', 'malformed-translation'))
  const byId = new Map<string, string[]>()
  for (const value of decoded.success ? decoded.data : []) {
    const record = recordSchema.safeParse(value)
    if (!record.success) { gaps.push(artifactGap('translation', 'invalid-record')); continue }
    const unit = source.units.find(unit => unit.id === record.data.unitId)
    if (!unit) { gaps.push(artifactGap('translation', 'unknown-unit')); continue }
    if (!isTranslationEligible(unit)) { gaps.push(unitGap(unit, 'translation', 'ineligible-unit')); continue }
    byId.set(unit.id, [...(byId.get(unit.id) ?? []), record.data.chinese])
  }
  const pairs = source.units.filter(isTranslationEligible).map(unit => {
    const records = byId.get(unit.id) ?? []
    const chinese = records.length === 1 && records[0]?.trim() ? records[0] : null
    if (chinese === null) gaps.push(unitGap(unit, 'translation', records.length > 1 ? 'duplicate-translation' : records.length === 0 ? 'missing-translation' : 'blank-translation'))
    return { unitId: unit.id, chinese }
  })
  return { pairs, gaps }
}
