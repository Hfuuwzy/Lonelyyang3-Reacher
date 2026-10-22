import { paperTaskSourceViewSchema, type PaperTaskSourceView } from '../../app/utils/paper-task-source-view'
import type { StoredSource } from './source-store'

const GAP_REASONS = {
  missing: '原文内容缺失。',
  ambiguous: '原文内容无法可靠区分。',
  unrecovered: '无法从原文恢复该内容。',
} as const

export function paperTaskSourceView(taskId: string, stored: StoredSource): PaperTaskSourceView {
  const records = new Map(stored.source.records.map((record) => [record.id, record]))
  const sourceGaps = stored.source.records.flatMap((record) => {
    if (record.state === 'present') return []
    return [{ id: record.id, reason: GAP_REASONS[record.state] }]
  })
  const sourceAssets = stored.assets.flatMap((asset) => {
    const record = records.get(asset.recordId)
    if (record === undefined || (record.kind !== 'figure' && record.kind !== 'table' && record.kind !== 'formula' && record.kind !== 'algorithm')) return []
    return [{
      id: asset.id,
      kind: record.kind,
      caption: (record.text.trim().split('\n')[0] || `原文${record.kind}`).slice(0, 500),
      availability: asset.availability === 'available' ? 'available' as const : 'missing' as const,
      understanding: 'unverified' as const,
      inputs: (stored.imageInputs ?? []).filter((input) => input.assetId === asset.id && input.recordId === asset.recordId).slice(0, 2),
    }]
  })
  const overflowed = sourceGaps.length > 100 || sourceAssets.length > 100
  const gaps: { id: string; reason: string }[] = sourceGaps.slice(0, overflowed ? 99 : 100)
  const assets = sourceAssets.slice(0, 100)
  if (overflowed) gaps.push({ id: 'omitted-materials', reason: '部分原文缺口或图表资产未显示。' })
  return paperTaskSourceViewSchema.parse({
    taskId,
    state: stored.source.status === 'complete' && !overflowed && sourceGaps.length === 0 && sourceAssets.every((asset) => asset.availability === 'available')
      ? 'prepared'
      : 'incomplete',
    gaps,
    assets,
  })
}
