import type { PaperSourceInventory, PaperTranslationPair, PaperReviewTaskGap } from '../../../app/utils/paper-review-task-contract'
import { isTranslationEligible } from '../../../app/utils/paper-review-task-contract'
import { z } from 'zod'
import { parseModelJson } from './model-json'
import { unitGap } from './source-ledger'

const recordSchema = z.object({ unitId: z.string().min(1), chinese: z.string() }).strict()

export function artifactGap(artifact: PaperReviewTaskGap['artifact'], code: string): PaperReviewTaskGap {
  return { artifact, code, origin: 'application', unitIds: [], readerPages: [], spans: [], reason: `${artifact}: ${code}` }
}

/** A per-unit translation gap carrying the unit's span for localization. */
function unitTranslationGap(source: PaperSourceInventory, unitId: string, code: string, reason: string): PaperReviewTaskGap {
  const unit = source.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) {
    return artifactGap('translation', code)
  }
  return { ...unitGap(unit, 'translation', code), reason }
}

export function eligibleIds(source: PaperSourceInventory): readonly string[] {
  return source.units.filter(isTranslationEligible).map((unit) => unit.id)
}

/**
 * Validate one bounded translation batch. `batchIds` are the exact eligible unit
 * ids this request asked the model to translate; the model may only emit records
 * for those ids. A missing, blank, or duplicate record localizes a gap on its
 * unit; an unknown, ineligible, or out-of-batch record is rejected and localized.
 */
export function validateTranslationBatch(
  source: PaperSourceInventory,
  batchIds: readonly string[],
  raw: string,
): {
  readonly pairs: readonly PaperTranslationPair[]
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  const decoded = z.array(z.unknown()).safeParse(parseModelJson(raw))
  const gaps: PaperReviewTaskGap[] = []
  if (!decoded.success) {
    gaps.push(unitTranslationGap(source, batchIds[0] ?? '', 'malformed-translation', 'The model translation response was not a JSON array.'))
  }
  const expected = new Set(batchIds)
  const byId = new Map<string, string[]>()
  for (const value of decoded.success ? decoded.data : []) {
    const record = recordSchema.safeParse(value)
    if (!record.success) {
      gaps.push(artifactGap('translation', 'invalid-record'))
      continue
    }
    const unit = source.units.find((candidate) => candidate.id === record.data.unitId)
    if (unit === undefined || !expected.has(record.data.unitId)) {
      gaps.push(unitTranslationGap(source, batchIds[0] ?? '', 'out-of-batch', `The model translated a unit outside this batch: ${record.data.unitId}.`))
      continue
    }
    if (!isTranslationEligible(unit)) {
      gaps.push(unitTranslationGap(source, record.data.unitId, 'ineligible-unit', 'The model translated a unit that is not translation-eligible.'))
      continue
    }
    byId.set(record.data.unitId, [...(byId.get(record.data.unitId) ?? []), record.data.chinese])
  }
  const pairs: PaperTranslationPair[] = []
  for (const unitId of batchIds) {
    const records = byId.get(unitId) ?? []
    const chinese = records.length === 1 && (records[0]?.trim() ?? '') !== '' ? records[0]! : null
    if (chinese === null) {
      const code = records.length > 1 ? 'duplicate-translation' : records.length === 0 ? 'missing-translation' : 'blank-translation'
      gaps.push(unitTranslationGap(source, unitId, code, `译文未生成或不可用（${code}），该单元没有中文。`))
    }
    pairs.push({ unitId, chinese })
  }
  return { pairs, gaps }
}

export function validateTranslations(source: PaperSourceInventory, raw: string): {
  readonly pairs: readonly PaperTranslationPair[]
  readonly gaps: readonly PaperReviewTaskGap[]
} {
  return validateTranslationBatch(source, eligibleIds(source), raw)
}