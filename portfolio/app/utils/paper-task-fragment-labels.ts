import type { PaperTaskFragmentReason, PaperTaskFragmentSource } from './paper-task-contract'

const REASON_LABELS: Record<PaperTaskFragmentReason, { readonly reader: string; readonly history: string }> = {
  'branch-running': { reader: '分支仍在运行，尚未发布主稿', history: '分支仍在运行' },
  'branch-failed': { reader: '分支失败，保留此前写入的内容', history: '分支失败后保留' },
  'task-stopped': { reader: '任务停止，保留此前写入的内容', history: '任务停止前保留' },
  'service-interrupted': { reader: '服务中断，任务不会自动续跑', history: '服务中断前保留' },
  'final-master-unavailable': { reader: '完整主稿不可读取', history: '完整主稿不可读' },
  'result-not-published': { reader: '分支尚未发布可验证主稿', history: '尚未发布可验证主稿' },
}

const SOURCE_LABELS: Record<PaperTaskFragmentSource, string> = {
  'drafts/translation/preview.md': '译文预览镜像',
  'drafts/translation/master.md': '译文主稿文件',
  'drafts/deep-reading/preview.md': '深读预览镜像',
  'drafts/deep-reading/report.md': '深读报告文件',
}

const SOURCE_TOKENS: Record<PaperTaskFragmentSource, string> = {
  'drafts/translation/preview.md': 'preview',
  'drafts/translation/master.md': 'master',
  'drafts/deep-reading/preview.md': 'preview',
  'drafts/deep-reading/report.md': 'report',
}

export function paperTaskFragmentReasonLabel(
  reason: PaperTaskFragmentReason,
  context: 'reader' | 'history' = 'reader',
): string {
  return REASON_LABELS[reason][context]
}

export function paperTaskFragmentSourceLabel(source: PaperTaskFragmentSource): string {
  return SOURCE_LABELS[source]
}

export function paperTaskFragmentSourceToken(source: PaperTaskFragmentSource): string {
  return SOURCE_TOKENS[source]
}
