import type { PaperTaskBranches, PaperTaskBranch, PaperTaskState } from '../../app/utils/paper-task-contract'
import {
  paperTaskReaderViewSchema,
  type PaperTaskReaderDocument,
  type PaperTaskReaderDocumentStatus,
  type PaperTaskReaderFormats,
  type PaperTaskReaderView,
} from '../../app/utils/paper-task-reader-contract'
import { readPaperTaskReading } from './reading-access'
import { readPaperTaskOriginalPdf, readPaperTaskTranslatedPdf } from './pdf-access'
import type { StoredSource } from './source-store'
import { readPaperTaskTranslation } from './translation-access'
import { readPaperTaskFormatStatus } from './artifact-export'
import type { PaperTaskExportFormat, PaperTaskExportStatus } from './artifact-export'
import { paperTaskBranchQuality, paperTaskDocumentQuality, type PaperTaskBranchQualityState } from './format-gate'

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
      const status = translationDocumentStatus(branches.translation, view.status)
      documents.push({
        branch: 'translation',
        status,
        notice: translationNotice(view.status, branches.translation),
        markdown: view.markdown,
        assets: view.assets,
        formats: formatStates(root, 'translation', view.markdown, paperTaskDocumentQuality(
          paperTaskBranchQuality(branches.translation), status,
        )),
      })
    }
  }

  if (READABLE_STATES.has(branches['deep-reading'])) {
    const view = readPaperTaskReading(taskId, root, stored)
    if (view !== undefined) {
      const status = readingDocumentStatus(branches['deep-reading'], view.status)
      documents.push({
        branch: 'deep-reading',
        status,
        notice: readingNotice(view.status, branches['deep-reading']),
        markdown: view.markdown,
        assets: view.assets,
        formats: formatStates(root, 'deep-reading', view.markdown, paperTaskDocumentQuality(
          paperTaskBranchQuality(branches['deep-reading']), status,
        )),
      })
    }
  }

  const originalAvailable = readPaperTaskOriginalPdf(root) !== undefined
  const translatedAvailable = documents.find((document) => document.branch === 'translation')?.formats.pdf.finalAvailable === true
    && branches.translation === 'complete'
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

function formatStates(
  root: string,
  branch: PaperTaskBranch,
  markdown: string,
  masterQuality: PaperTaskBranchQualityState,
) {
  const formats = ['markdown', 'assets', 'pdf'] as const
  return Object.fromEntries(formats.map((format) => {
    const { branch: _branch, format: _format, ...state } = readPaperTaskFormatStatus(root, branch, format, markdown, masterQuality)
    return [format, { ...state, message: formatMessage(format, state.status) }]
  })) as PaperTaskReaderFormats
}

function formatMessage(format: PaperTaskExportFormat, status: PaperTaskExportStatus): string {
  const label = format === 'markdown' ? 'Markdown'
    : format === 'assets' ? '受控资产包' : 'PDF'
  if (status === 'complete') return `${label} 已与当前主稿一致；${format === 'markdown' || format === 'assets' ? '可取得。' : '已完成逐页检查，可作为最终成品取得。'}`
  if (status === 'preview') return `${label} 仍是预览状态；主稿尚未达到最终质量门槛。`
  if (status === 'needs-confirmation') return `${label} 尚未通过所需检查；可读 Markdown 和其他格式状态保持独立。`
  if (status === 'failed') return `${label} 构建或边界校验失败；不会隐藏其他格式或阅读正文。`
  return `${label} 尚未构建。`
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
