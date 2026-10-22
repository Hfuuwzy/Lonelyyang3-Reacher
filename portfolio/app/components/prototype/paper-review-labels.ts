import { API_PROTOCOLS } from './api-settings-config'
import type { PaperReviewGap, PaperReviewSectionKind, PaperReviewStage } from '~/utils/paper-review-contract'

export interface PaperReviewStageStep {
  readonly stage: PaperReviewStage
  readonly label: string
  readonly ordinal: string
}

export const PAPER_REVIEW_STAGE_STEPS: readonly PaperReviewStageStep[] = [
  { stage: 'validating', label: '校验', ordinal: '一' },
  { stage: 'extracting', label: '抽取', ordinal: '二' },
  { stage: 'inventorying', label: '清点', ordinal: '三' },
  { stage: 'analyzing', label: '分析', ordinal: '四' },
  { stage: 'translating', label: '翻译', ordinal: '五' },
  { stage: 'verifying', label: '核验', ordinal: '六' },
]

export function paperReviewStageLabel(stage: PaperReviewStage): string {
  return PAPER_REVIEW_STAGE_STEPS.find((step) => step.stage === stage)?.label ?? stage
}

export const PAPER_REVIEW_SECTION_KIND_LABELS = {
  claims: '论断',
  methods: '方法',
  experiments: '实验',
  evidence: '证据',
  criticism: '批评',
} as const satisfies Record<PaperReviewSectionKind, string>

export function paperReviewSectionKindLabel(kind: PaperReviewSectionKind): string {
  return PAPER_REVIEW_SECTION_KIND_LABELS[kind]
}

export interface PaperReviewProtocolOption {
  readonly value: string
  readonly label: string
}

export const PAPER_REVIEW_PROTOCOL_OPTIONS: readonly PaperReviewProtocolOption[] = [
  { value: API_PROTOCOLS.openaiCompletions, label: 'OpenAI Chat Completions' },
  { value: API_PROTOCOLS.anthropicMessages, label: 'Anthropic Messages' },
]

export function paperReviewProtocolLabel(protocol: string): string {
  return PAPER_REVIEW_PROTOCOL_OPTIONS.find((option) => option.value === protocol)?.label ?? protocol
}

/**
 * Display labels for known gap scopes emitted by the report pipeline or named
 * by the model. Keys are compared after trim + lowercase, so `Claims` and
 * `claims` map to the same label. Anything not listed here is preserved
 * verbatim — no guessed translation.
 */
export const PAPER_REVIEW_GAP_SCOPE_LABELS: Readonly<Record<string, string>> = {
  claims: '论断',
  methods: '方法',
  experiments: '实验',
  evidence: '证据',
  criticism: '批评',
  'pdf source': 'PDF 原文',
  overall: '整体',
  'full-translation': '全文翻译',
}

/** Maps a gap scope string to its display label; unknown scopes stay verbatim. */
export function paperReviewGapScopeLabel(scope: string): string {
  return PAPER_REVIEW_GAP_SCOPE_LABELS[scope.trim().toLowerCase()] ?? scope
}

export interface PaperReviewGapItem {
  readonly reason: string
  /** Display labels of every scope sharing `reason`, in first-seen order. */
  readonly scopes: readonly string[]
}

/**
 * Groups wire gaps for display: gaps with an exactly identical reason collapse
 * into one item listing every affected scope, duplicate reason/scope pairs are
 * dropped, and items and scopes both keep the wire's first-seen order.
 */
export function paperReviewGapItems(gaps: readonly PaperReviewGap[]): readonly PaperReviewGapItem[] {
  const scopesByReason = new Map<string, string[]>()
  for (const gap of gaps) {
    const scope = paperReviewGapScopeLabel(gap.section)
    const scopes = scopesByReason.get(gap.reason)
    if (scopes === undefined) {
      scopesByReason.set(gap.reason, [scope])
    } else if (!scopes.includes(scope)) {
      scopes.push(scope)
    }
  }
  return Array.from(scopesByReason, ([reason, scopes]) => ({ reason, scopes }))
}

export const PAPER_REVIEW_UNKNOWN_HEADING_LABEL = '未提供章节标题'

export function paperReviewHeadingLabel(heading: string): string {
  return heading.trim() === '' ? PAPER_REVIEW_UNKNOWN_HEADING_LABEL : heading
}
