import { describe, expect, it } from 'vitest'
import type {
  PaperTaskReaderBranch,
  PaperTaskReaderDocumentStatus,
} from '../../app/utils/paper-task-reader-contract'
import { paperTaskReaderDocumentLabel } from '../../app/utils/paper-task-reader-labels'

const LABEL_CASES = [
  { branch: 'translation', status: 'preview', label: '译文草稿' },
  { branch: 'translation', status: 'needs-confirmation', label: '译文草稿' },
  { branch: 'translation', status: 'complete', label: '全文译文' },
  { branch: 'deep-reading', status: 'preview', label: '深读报告' },
  { branch: 'deep-reading', status: 'needs-confirmation', label: '深读报告' },
  { branch: 'deep-reading', status: 'complete', label: '深读报告' },
] as const satisfies readonly {
  readonly branch: PaperTaskReaderBranch
  readonly status: PaperTaskReaderDocumentStatus
  readonly label: string
}[]

describe('paper task reader document labels', () => {
  it.each(LABEL_CASES)('$branch with $status status uses its truthful label', ({ branch, status, label }) => {
    expect(paperTaskReaderDocumentLabel(branch, status)).toBe(label)
  })
})
