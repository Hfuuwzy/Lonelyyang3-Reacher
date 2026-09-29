import { API_PROTOCOLS } from './api-settings-config'
import type { PaperReviewSectionKind, PaperReviewStage } from '~/utils/paper-review-contract'

export interface PaperReviewStageStep {
  readonly stage: PaperReviewStage
  readonly label: string
  readonly ordinal: string
}

export const PAPER_REVIEW_STAGE_STEPS: readonly PaperReviewStageStep[] = [
  { stage: 'validating', label: '校验', ordinal: '一' },
  { stage: 'extracting', label: '抽取', ordinal: '二' },
  { stage: 'analyzing', label: '分析', ordinal: '三' },
  { stage: 'verifying', label: '核验', ordinal: '四' },
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
