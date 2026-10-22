import { describe, expect, it } from 'vitest'
import type { PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import {
  PAPER_TASK_IMAGE_NO_INPUTS_LABEL,
  paperTaskImageInputLabel,
} from '../../app/utils/paper-task-image-labels'

const RECEIPT: PaperTaskImageReceipt = {
  branch: 'translation',
  assetId: 'asset-0123456789abcdef0123456789abcdef',
  recordId: 'p1-r1',
  revision: 1,
  status: 'blocked',
  reason: null,
}

describe('paper task image input labels', () => {
  it('labels an empty inputs array as unrecorded and unverified', () => {
    // Given an asset with no branch input receipts.

    // When its empty-input label is selected.

    // Then the copy does not imply successful image transport.
    expect(PAPER_TASK_IMAGE_NO_INPUTS_LABEL).toBe('尚无图像输入记录；模型理解未核验')
  })

  it('shows that a branch has no receipt when its peer has one', () => {
    // Given a translation receipt and no deep-reading receipt.

    // When the deep-reading branch label is rendered.
    const label = paperTaskImageInputLabel('deep-reading', undefined)

    // Then the absent branch remains explicitly unrecorded.
    expect(label).toBe('深读输入：尚无该分支图像输入记录')
  })

  it.each([
    ['not-sent', '未发送'],
    ['blocked', '已阻止'],
    ['transported', '已传输，理解未核验'],
    ['interrupted', '传输已中断，理解未核验'],
  ] as const)('labels %s status without claiming verified understanding', (status, statusLabel) => {
    // Given a receipt for the translation branch with no failure reason.

    // When its transport status is rendered.
    const label = paperTaskImageInputLabel('translation', { ...RECEIPT, status })

    // Then the branch and truthful status are both visible.
    expect(label).toBe(`译文输入：${statusLabel}`)
  })

  it('keeps the transported label explicitly unverified for deep reading', () => {
    // Given a transported receipt for the deep-reading branch.

    // When its status is rendered.
    const label = paperTaskImageInputLabel('deep-reading', {
      ...RECEIPT,
      branch: 'deep-reading',
      status: 'transported',
    })

    // Then it does not claim model comprehension or output quality.
    expect(label).toBe('深读输入：已传输，理解未核验')
  })

  it.each([
    ['not-enabled', '图像输入未启用'],
    ['missing', '原始图像缺失'],
    ['unreadable', '原始图像不可读取'],
    ['invalid-image', '图像格式无效'],
    ['image-too-large', '单张图像超过大小限制'],
    ['image-too-many-pixels', '单张图像像素数超过限制'],
    ['image-dimension-too-large', '单张图像尺寸超过限制'],
    ['too-many-images', '图像数量超过限制'],
    ['aggregate-image-too-large', '图像总大小超过限制'],
    ['context-too-large', '图像上下文超过限制'],
    ['unsupported-protocol', '所选协议不支持图像输入'],
    ['request-too-large', '请求体超过大小限制'],
    ['unexpected-image', '收到非预期图像'],
    ['changed-image', '图像在传输前发生变化'],
    ['missing-image', '请求所需图像未提供'],
    ['provider-failed', '提供方传输失败'],
    ['cancelled', '传输已取消'],
    ['unwired', '图像传输未接入'],
    ['stale-source', '原文来源已过期'],
  ] as const)('shows the %s receipt reason', (reason, reasonLabel) => {
    // Given a blocked translation receipt with a contract-defined reason.

    // When its status and reason are rendered.
    const label = paperTaskImageInputLabel('translation', { ...RECEIPT, reason })

    // Then the status stays visible alongside the localized reason.
    expect(label).toBe(`译文输入：已阻止（原因：${reasonLabel}）`)
  })
})
