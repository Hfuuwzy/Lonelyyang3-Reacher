import { paperTaskFragmentSchema } from '../../app/utils/paper-task-contract'
import type { PaperTaskBranches, PaperTaskBranch, PaperTaskOutcome, PaperTaskState } from '../../app/utils/paper-task-contract'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperTaskQuality, PaperTaskFragment, PaperTaskFragmentSource } from '../../app/utils/paper-task-contract'
import {
  paperTaskReaderDocumentSchema,
  paperTaskReaderViewSchema,
  type PaperTaskReaderDocument,
  type PaperTaskReaderMasterStatus,
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
const MAX_FRAGMENT_BYTES = 1_600_000
const MAX_FRAGMENT_LENGTH = 500_000
const VISUAL_KINDS = new Set(['figure', 'table', 'formula', 'algorithm'])

export interface PaperTaskReaderPreviewMetadata {
  readonly quality?: Partial<Record<PaperTaskBranch, PaperTaskQuality>>
  readonly taskOutcome?: PaperTaskOutcome | undefined
}

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
  stored: StoredSource | undefined,
  preview: PaperTaskReaderPreviewMetadata = {},
): PaperTaskReaderView | undefined {
  const documents: PaperTaskReaderDocument[] = []

  if (branches.translation !== 'not-selected') {
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
      } else {
        const fragment = readFragment(taskId, root, 'translation', branches.translation, preview.quality?.translation, stored, preview.taskOutcome)
        if (fragment !== undefined) documents.push(fragment)
      }
    } else {
      const fragment = readFragment(taskId, root, 'translation', branches.translation, preview.quality?.translation, stored, preview.taskOutcome)
      if (fragment !== undefined) documents.push(fragment)
    }
  }

  if (branches['deep-reading'] !== 'not-selected') {
    if (READABLE_STATES.has(branches['deep-reading'])) {
      const view = stored !== undefined
        ? readPaperTaskReading(taskId, root, stored)
        : undefined
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
      } else {
        const fragment = readFragment(taskId, root, 'deep-reading', branches['deep-reading'], preview.quality?.['deep-reading'], stored, preview.taskOutcome)
        if (fragment !== undefined) documents.push(fragment)
      }
    } else {
      const fragment = readFragment(taskId, root, 'deep-reading', branches['deep-reading'], preview.quality?.['deep-reading'], stored, preview.taskOutcome)
      if (fragment !== undefined) documents.push(fragment)
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
          : branches.translation === 'needs-confirmation'
            ? '译文稿仍有待确认事项；完成内容核对并重新审阅后才可生成最终 PDF。当前可下载 Markdown 继续核对。'
            : branches.translation === 'complete'
              ? '译文稿已确认，但逐页检查或格式校验尚未通过，最终 PDF 暂不可导出。'
              : branches.translation === 'failed'
                ? '译文生成失败，没有可导出的最终 PDF。'
                : '译文尚未完成，最终 PDF 暂不可导出。',
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

function documentStatus(state: PaperTaskState): PaperTaskReaderMasterStatus {
  if (state === 'complete') return 'complete'
  if (state === 'needs-confirmation') return 'needs-confirmation'
  return 'preview'
}

/** A readable master that still has missing or stale material is never complete. */
function translationDocumentStatus(
  branch: PaperTaskState,
  viewStatus: 'complete' | 'incomplete' | 'needs-update',
): PaperTaskReaderMasterStatus {
  if (viewStatus !== 'complete') return 'needs-confirmation'
  return documentStatus(branch)
}

/** A report that retained unverified material is never presented as complete. */
function readingDocumentStatus(
  branch: PaperTaskState,
  viewStatus: 'preview' | 'needs-confirmation',
): PaperTaskReaderMasterStatus {
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

function readFragment(
  taskId: string,
  root: string,
  branch: PaperTaskBranch,
  branchState: PaperTaskState,
  quality: PaperTaskQuality | undefined,
  stored: StoredSource | undefined,
  taskOutcome: PaperTaskOutcome | undefined,
): PaperTaskReaderDocument | undefined {
  const body = readBranchFragmentBody(root, branch)
  if (body === undefined) return undefined
  const { source, markdown } = body

  const fragment = paperTaskFragmentSchema.safeParse({
    taskId,
    branch,
    identity: `sha256:${createHash('sha256').update(markdown, 'utf8').digest('hex')}`,
    source,
    reason: fragmentReason(branchState, taskOutcome),
    quality: quality ?? null,
  })
  if (!fragment.success) return undefined

  const view = {
    branch,
    status: 'fragment' as const,
    notice: fragmentNotice(fragment.data.reason),
    markdown,
    assets: fragmentAssets(markdown, stored),
    formats: fragmentFormats(branch),
    fragment: fragment.data,
  }
  const parsed = paperTaskReaderDocumentSchema.safeParse(view)
  return parsed.success ? parsed.data : undefined
}

function readBranchFragmentBody(
  root: string,
  branch: PaperTaskBranch,
): { readonly source: PaperTaskFragmentSource; readonly markdown: string } | undefined {
  const directory = join(root, 'drafts', branch)
  const candidates: readonly { readonly fileName: string; readonly source: PaperTaskFragmentSource }[] = branch === 'translation'
    ? [
        { fileName: 'preview.md', source: 'drafts/translation/preview.md' },
        { fileName: 'master.md', source: 'drafts/translation/master.md' },
      ]
    : [
        { fileName: 'preview.md', source: 'drafts/deep-reading/preview.md' },
        { fileName: 'report.md', source: 'drafts/deep-reading/report.md' },
      ]

  try {
    const directoryInfo = lstatSync(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return undefined
  } catch {
    return undefined
  }

  for (const candidate of candidates) {
    const path = join(directory, candidate.fileName)
    try {
      const file = lstatSync(path)
      if (!file.isFile() || file.isSymbolicLink() || file.size === 0 || file.size > MAX_FRAGMENT_BYTES) continue
      const bytes = readFileSync(path)
      const markdown = bytes.toString('utf8')
      if (Buffer.from(markdown, 'utf8').compare(bytes) !== 0
        || markdown.trim().length === 0
        || markdown.length > MAX_FRAGMENT_LENGTH) continue
      return { source: candidate.source, markdown }
    } catch {
      // Prefer the branch-local preview mirror, then inspect the canonical body.
    }
  }
  return undefined
}

function fragmentReason(state: PaperTaskState, outcome: PaperTaskOutcome | undefined): PaperTaskFragment['reason'] {
  if (outcome === 'cancelled') return 'task-stopped'
  if (outcome === 'interrupted') return 'service-interrupted'
  switch (state) {
    case 'running':
    case 'pending': return 'branch-running'
    case 'failed': return 'branch-failed'
    case 'cancelled': return 'task-stopped'
    case 'interrupted': return 'service-interrupted'
    case 'complete': return 'final-master-unavailable'
    case 'not-selected': return 'result-not-published'
    case 'sample-ready':
    case 'preview-ready':
    case 'needs-confirmation': return 'result-not-published'
    default: {
      const exhaustive: never = state
      throw new Error(`unreachable paper-task fragment state: ${String(exhaustive)}`)
    }
  }
}

function fragmentNotice(reason: PaperTaskFragment['reason']): string {
  switch (reason) {
    case 'branch-running': return '这是任务分支已保存的未完成片段；该分支仍在运行，不代表完整主稿。'
    case 'branch-failed': return '这是任务分支失败前已保存的未完成片段，不代表完整主稿。'
    case 'task-stopped': return '这是任务停止前已保存的未完成片段，不代表完整主稿。'
    case 'service-interrupted': return '这是服务中断前已保存的未完成片段；任务不会自动续跑。'
    case 'final-master-unavailable': return '完整主稿当前不可读取；仅显示该分支实际保存的未完成片段。'
    case 'result-not-published': return '该分支尚未发布可验证的主稿；仅显示实际保存的未完成片段。'
    default: {
      const exhaustive: never = reason
      throw new Error(`unreachable paper-task fragment reason: ${String(exhaustive)}`)
    }
  }
}

function fragmentFormats(branch: PaperTaskBranch): PaperTaskReaderFormats {
  const names = {
    markdown: `${branch}-fragment.md`,
    assets: `${branch}-fragment-assets.zip`,
    pdf: `${branch}-fragment.pdf`,
  }
  return Object.fromEntries((['markdown', 'assets', 'pdf'] as const).map((format) => [format, {
    status: 'needs-confirmation',
    build: 'unbuilt',
    fileName: names[format],
    available: false,
    inspectionAvailable: false,
    finalAvailable: false,
    pages: [],
    blockers: ['unpublished-fragment'],
    boundaryVerified: false,
    message: '未完成片段仅供阅读和下载原文，不可构建为正式交付物。',
  }])) as PaperTaskReaderFormats
}

function fragmentAssets(markdown: string, stored: StoredSource | undefined) {
  if (stored === undefined) return []
  const referenced = new Set<string>()
  const prose = markdown.replace(/```[\s\S]*?```/gu, '').replace(/~~~[\s\S]*?~~~/gu, '')
  for (const match of prose.matchAll(/!\[[^\]\n]*\]\(asset:(asset-[0-9a-f]{32})\)/gu)) {
    if (match[1] !== undefined) referenced.add(match[1])
  }
  const records = new Map(stored.source.records.map((record) => [record.id, record]))
  return stored.assets.flatMap((asset) => {
    if (!referenced.has(asset.id)) return []
    const record = records.get(asset.recordId)
    if (record === undefined || !VISUAL_KINDS.has(record.kind)) return []
    const kind = record.kind as 'figure' | 'table' | 'formula' | 'algorithm'
    const caption = (record.text.trim().split('\n')[0]?.trim() || `原文${kind}`).slice(0, 500)
    return [{
      id: asset.id,
      kind,
      caption,
      availability: asset.availability === 'available' ? 'available' as const : 'missing' as const,
    }]
  })
}
