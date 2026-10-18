import type { PaperTaskBranches, PaperTaskState } from '../../app/utils/paper-task-contract'
import {
  paperTaskReaderViewSchema,
  type PaperTaskReaderDocument,
  type PaperTaskReaderDocumentStatus,
  type PaperTaskReaderView,
} from '../../app/utils/paper-task-reader-contract'
import { readPaperTaskReading } from './reading-access'
import { readPaperTaskOriginalPdf, readPaperTaskTranslatedPdf } from './pdf-access'
import type { StoredSource } from './source-store'
import { readPaperTaskTranslation } from './translation-access'

const READABLE_STATES = new Set<PaperTaskState>(['preview-ready', 'needs-confirmation', 'complete', 'sample-ready'])

/**
 * Builds the C focused-reader view for one current task.
 *
 * Only readable branches contribute documents; a failed or cancelled branch
 * never hides a sibling result. The original PDF is a separate entry, and the
 * translated PDF is offered only when the server can prove the qualified
 * artifact exists.
 */
export function readPaperTaskReader(
  taskId: string,
  root: string,
  branches: PaperTaskBranches,
  stored: StoredSource,
): PaperTaskReaderView | undefined {
  const documents: PaperTaskReaderDocument[] = []

  if (READABLE_STATES.has(branches.translation)) {
    const view = readPaperTaskTranslation(taskId, root)
    if (view !== undefined) {
      documents.push({
        branch: 'translation',
        status: translationDocumentStatus(branches.translation, view.status),
        notice: translationNotice(view.status, branches.translation),
        markdown: view.markdown,
        assets: view.assets,
      })
    }
  }

  if (READABLE_STATES.has(branches['deep-reading'])) {
    const view = readPaperTaskReading(taskId, root, stored)
    if (view !== undefined) {
      documents.push({
        branch: 'deep-reading',
        status: readingDocumentStatus(branches['deep-reading'], view.status),
        notice: readingNotice(view.status, branches['deep-reading']),
        markdown: view.markdown,
        assets: view.assets,
      })
    }
  }

  const originalAvailable = readPaperTaskOriginalPdf(root) !== undefined
  const translatedAvailable = branches.translation === 'complete'
    && readPaperTaskTranslatedPdf(root, 'complete') !== undefined
  const view = {
    taskId,
    branches: { translation: branches.translation, 'deep-reading': branches['deep-reading'] },
    documents,
    pdfs: {
      original: {
        available: originalAvailable,
        message: originalAvailable ? '原论文 PDF 可查看。' : '原论文 PDF 暂不可用。',
      },
      translated: {
        available: translatedAvailable,
        message: translatedAvailable
          ? '译文 PDF 已通过检查，可打开或下载同一文件。'
          : '译文 PDF 尚未生成或尚未通过全页检查。',
      },
    },
  }
  const parsed = paperTaskReaderViewSchema.safeParse(view)
  return parsed.success ? parsed.data : undefined
}

function documentStatus(state: PaperTaskState): PaperTaskReaderDocumentStatus {
  if (state === 'complete') return 'complete'
  if (state === 'needs-confirmation') return 'needs-confirmation'
  return 'preview'
}

/** A readable master that still has missing or stale material is never complete. */
function translationDocumentStatus(
  branch: PaperTaskState,
  viewStatus: 'complete' | 'incomplete' | 'needs-update',
): PaperTaskReaderDocumentStatus {
  if (viewStatus !== 'complete') return 'needs-confirmation'
  return documentStatus(branch)
}

/** A report that retained unverified material is never presented as complete. */
function readingDocumentStatus(
  branch: PaperTaskState,
  viewStatus: 'preview' | 'needs-confirmation',
): PaperTaskReaderDocumentStatus {
  if (viewStatus === 'needs-confirmation') return 'needs-confirmation'
  return documentStatus(branch)
}

function translationNotice(
  status: 'complete' | 'incomplete' | 'needs-update',
  branch: PaperTaskState,
): string | null {
  if (status === 'needs-update') {
    return '原文修正后，部分段落可能已过期；已有可读内容保留，请返回任务工作台核对原文资料。'
  }
  if (status === 'incomplete') {
    return '部分原文内容缺失或未核实；已有可读内容保留，请返回任务工作台核对原文资料。'
  }
  if (branch === 'needs-confirmation') {
    return '仍有可能需要人工确认的疑点；已有可读内容保留，请返回任务工作台核对。'
  }
  return null
}

function readingNotice(
  status: 'preview' | 'needs-confirmation',
  branch: PaperTaskState,
): string | null {
  if (status === 'needs-confirmation' || branch === 'needs-confirmation') {
    return '报告保留了未完成或未核实材料；已有可读内容保留，请返回任务工作台核对原文资料。'
  }
  return null
}
