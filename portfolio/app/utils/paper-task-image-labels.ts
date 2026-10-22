import type { PaperTaskImageBranch as PaperTaskBranch, PaperTaskImageReason, PaperTaskImageReceipt } from './paper-task-image-contract'

const BRANCH_LABELS = {
  translation: '译文输入',
  'deep-reading': '深读输入',
} as const satisfies Record<PaperTaskBranch, string>

const STATUS_LABELS = {
  'not-sent': '未发送',
  blocked: '已阻止',
  transported: '已传输，理解未核验',
  interrupted: '传输已中断，理解未核验',
} as const satisfies Record<PaperTaskImageReceipt['status'], string>

const REASON_LABELS = {
  'not-enabled': '图像输入未启用',
  missing: '原始图像缺失',
  unreadable: '原始图像不可读取',
  'invalid-image': '图像格式无效',
  'image-too-large': '单张图像超过大小限制',
  'image-too-many-pixels': '单张图像像素数超过限制',
  'image-dimension-too-large': '单张图像尺寸超过限制',
  'too-many-images': '图像数量超过限制',
  'aggregate-image-too-large': '图像总大小超过限制',
  'context-too-large': '图像上下文超过限制',
  'unsupported-protocol': '所选协议不支持图像输入',
  'request-too-large': '请求体超过大小限制',
  'unexpected-image': '收到非预期图像',
  'changed-image': '图像在传输前发生变化',
  'missing-image': '请求所需图像未提供',
  'provider-failed': '提供方传输失败',
  cancelled: '传输已取消',
  unwired: '图像传输未接入',
  'stale-source': '原文来源已过期',
} as const satisfies Record<PaperTaskImageReason, string>

export const PAPER_TASK_IMAGE_NO_INPUTS_LABEL = '尚无图像输入记录；模型理解未核验'

export function paperTaskImageInputLabel(
  branch: PaperTaskBranch,
  receipt: PaperTaskImageReceipt | undefined,
): string {
  const branchLabel = BRANCH_LABELS[branch]
  if (receipt === undefined) {
    return `${branchLabel}：尚无该分支图像输入记录`
  }

  const statusLabel = STATUS_LABELS[receipt.status]
  const reasonLabel = receipt.reason === null ? null : REASON_LABELS[receipt.reason]
  const reasonText = reasonLabel === null ? '' : `（原因：${reasonLabel}）`
  return `${branchLabel}：${statusLabel}${reasonText}`
}
