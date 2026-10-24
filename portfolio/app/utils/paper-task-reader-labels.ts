import type {
  PaperTaskReaderBranch,
  PaperTaskReaderDocumentStatus,
} from './paper-task-reader-contract'

const DOCUMENT_LABELS = {
  translation: {
    fragment: '译文未完成片段',
    preview: '译文草稿',
    'needs-confirmation': '译文草稿',
    complete: '全文译文',
  },
  'deep-reading': {
    fragment: '深读未完成片段',
    preview: '深读报告',
    'needs-confirmation': '深读报告',
    complete: '深读报告',
  },
} as const satisfies Record<PaperTaskReaderBranch, Record<PaperTaskReaderDocumentStatus, string>>

export function paperTaskReaderDocumentLabel(
  branch: PaperTaskReaderBranch,
  status: PaperTaskReaderDocumentStatus,
): string {
  return DOCUMENT_LABELS[branch][status]
}
