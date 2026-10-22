/**
 * Known task-gap code -> Chinese action copy for the paper-review readers
 * (used by `paper-review-gaps.ts`). Pure data, browser-safe.
 *
 * Covers the codes the backend pipeline emits today (`server/utils/paper-review/*`
 * and `server/paper-review-internal/*`), including the extractor geometry codes
 * (`layout-ambiguity`, `empty-page`, `geometry-unavailable`), the pipeline codes
 * (`review-run-failed`, `inventory-run-failed`) and the source-classification
 * codes from inventory reconciliation (`invalid-classification`,
 * `out-of-batch-candidate`, `duplicate-candidate`, `classifier-omission`,
 * `classification-mismatch`, the `invented-*` family). `invalid-record` resolves
 * per artifact in `paperReviewGapCodeAction`; codes not listed here fall back to
 * a generic Chinese line so a human line never shows raw English (the raw code
 * and reason stay in the technical details).
 */

import type { PaperReviewTaskGap } from '~/utils/paper-review-task-contract'

export const PAPER_REVIEW_GAP_CODE_ACTIONS: Readonly<Record<string, string>> = {
  'unresolved-source': '原文片段未被解析，无法参与抽取或翻译',
  'invalid-partition': '原文分区无效或不完整',
  'layout-ambiguity': '该范围的原文阅读顺序需要核对，请查看对应 PDF 页面',
  'empty-page': '该页没有可提取文字，可能为空白页或图片页，当前未进行 OCR',
  'geometry-unavailable': '原文候选缺少可用的版面几何，无法定位内容',
  'malformed-translation': '译文内容格式不正确，已忽略',
  'unknown-unit': '译文条目指向不存在的原文单元，已忽略',
  'ineligible-unit': '译文条目落在不翻译的范围，已忽略',
  'duplicate-translation': '同一单元返回多份译文，已弃用',
  'missing-translation': '该单元没有返回译文',
  'blank-translation': '该单元的译文为空，已弃用',
  'translation-run-failed': '本次未能生成译文',
  'no-eligible-units': '原文中没有可翻译的正文内容',
  'review-fingerprint-mismatch': '核验指纹与本次原文不一致，核验结果不可用',
  'invalid-check': '核验条目格式不正确，已忽略',
  'unknown-check': '核验条目指向不存在的原文单元，已忽略',
  'missing-check': '该单元缺少核验结果',
  'duplicate-check': '同一单元返回多份核验结果',
  'review-issues': '该单元核验存在问题',
  'review-not-run': '本次未执行原文对照复检',
  'review-run-failed': '本次未能完成该单元的原文对照复检',
  'inventory-run-failed': '本次原文分类未完成，可读正文仍保留供翻译，请核对后重新提交',
  'inventory-oversize': '原文分类材料超过单次处理上限，该范围未完成分类',
  'oversize-prompt': '该范围超过单次处理上限，未截断内容；请核对或分拆 PDF 后重新提交',
  'invalid-classification': '模型清点结果不是有效的候选分类列表，已忽略',
  'out-of-batch-candidate': '模型清点了本次批次之外的原文候选，已忽略',
  'duplicate-candidate': '同一原文候选被重复清点，已弃用',
  'classifier-omission': '模型漏清点了原文候选，以应用证据为准',
  'classification-mismatch': '模型清点结果与应用证据不一致，以应用证据为准',
  'invented-excluded': '模型无证据将正文标为排除，仍按可译正文保留',
  'invented-preserved-original': '模型无证据将正文标为原文保留，仍按可译正文保留',
  'invented-caption': '模型无证据将正文标为图注，仍按可译正文保留',
  'invented-unresolved': '模型未确定正文类型，可读文字仍按正文保留并参与翻译',
}

/** Human fallback for a code the mapping does not know yet. */
export const PAPER_REVIEW_GAP_UNKNOWN_ACTION = '未能识别的缺口类型，详见技术细节'

/** `invalid-record` is artifact-aware: a `source` record is a malformed
 * classification entry, a `translation` record a malformed translation entry. */
export function paperReviewInvalidRecordAction(artifact: PaperReviewTaskGap['artifact'] | undefined): string {
  switch (artifact) {
    case 'source':
      return '清点条目格式不正确，已忽略'
    case 'translation':
      return '译文条目格式不正确，已忽略'
    default:
      return '条目格式不正确，已忽略'
  }
}

/** Chinese action copy for a task-gap code; unknown codes fall back to the generic line. */
export function resolvePaperReviewGapCodeAction(
  code: string,
  artifact?: PaperReviewTaskGap['artifact'],
): string {
  if (code === 'invalid-record') {
    return paperReviewInvalidRecordAction(artifact)
  }
  return PAPER_REVIEW_GAP_CODE_ACTIONS[code] ?? PAPER_REVIEW_GAP_UNKNOWN_ACTION
}

export function resolvePaperReviewArtifactLabel(artifact: PaperReviewTaskGap['artifact']): string {
  switch (artifact) {
    case 'source':
      return '来源'
    case 'report':
      return '报告'
    case 'translation':
      return '译文'
    case 'source-review':
      return '核验'
  }
}
