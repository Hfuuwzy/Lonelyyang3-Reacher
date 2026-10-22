/**
 * Browser-safe contract for the paper-task C focused reader (issue #48).
 *
 * One task-selected result document per readable branch: the natural Chinese
 * translation master and/or the independent deep-reading report. Branch states
 * stay explicit so an unfinished document is never presented as a complete
 * artifact. Original and translated PDFs are separate entries; the translated
 * entry is usable only when the server has a qualified artifact.
 */

import { z } from 'zod'
import { paperTaskStateSchema } from './paper-task-contract'
import { PAPER_TASK_READING_LIMITS } from './paper-task-reading-contract'
import {
  PAPER_TASK_TRANSLATION_LIMITS,
  paperTaskControlledAssetSchema,
} from './paper-task-translation-contract'

export const PAPER_TASK_READER_BRANCH_DOCUMENTS = ['translation', 'deep-reading'] as const
export type PaperTaskReaderBranch = (typeof PAPER_TASK_READER_BRANCH_DOCUMENTS)[number]

export const PAPER_TASK_READER_DOCUMENT_STATUSES = ['preview', 'needs-confirmation', 'complete'] as const
export type PaperTaskReaderDocumentStatus = (typeof PAPER_TASK_READER_DOCUMENT_STATUSES)[number]

export const PAPER_TASK_READER_PDF_KINDS = ['original', 'translated'] as const
export type PaperTaskPdfKind = (typeof PAPER_TASK_READER_PDF_KINDS)[number]

export const PAPER_TASK_EXPORT_FORMATS = ['markdown', 'assets', 'pdf'] as const
export type PaperTaskExportFormat = (typeof PAPER_TASK_EXPORT_FORMATS)[number]
export type PaperTaskExportStatus = 'unbuilt' | 'preview' | 'needs-confirmation' | 'complete' | 'failed'

export const PAPER_TASK_READER_LIMITS = {
  maxDocuments: 2,
  maxNoticeLength: 300,
  maxPdfMessage: 300,
  maxFormatMessage: 300,
  maxPageEvidenceLength: 500,
} as const

const pdfStateSchema = z.object({
  available: z.boolean(),
  message: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxPdfMessage),
}).strict().readonly()

const formatPageSchema = z.object({
  page: z.number().int().positive(),
  status: z.enum(['passed', 'minor', 'blocked']),
  expected: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxPageEvidenceLength),
  observed: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxPageEvidenceLength),
  evidence: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxPageEvidenceLength),
  reason: z.string().max(PAPER_TASK_READER_LIMITS.maxPageEvidenceLength).optional(),
}).strict().readonly()

const formatStateSchema = z.object({
  status: z.enum(['unbuilt', 'preview', 'needs-confirmation', 'complete', 'failed']),
  build: z.enum(['unbuilt', 'built', 'failed']),
  fileName: z.string().min(1).max(120),
  available: z.boolean(),
  inspectionAvailable: z.boolean(),
  finalAvailable: z.boolean(),
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  expectedPageCount: z.number().int().positive().max(5000).optional(),
  pages: z.array(formatPageSchema).max(5000).readonly(),
  blockers: z.array(z.string().min(1).max(300)).max(100).readonly(),
  boundaryVerified: z.boolean(),
  message: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxFormatMessage),
}).strict().readonly()

const formatStatesSchema = z.object({
  markdown: formatStateSchema,
  assets: formatStateSchema,
  pdf: formatStateSchema,
}).strict().readonly()

const readerDocumentSchema = z.object({
  branch: z.enum(PAPER_TASK_READER_BRANCH_DOCUMENTS),
  status: z.enum(PAPER_TASK_READER_DOCUMENT_STATUSES),
  notice: z.string().min(1).max(PAPER_TASK_READER_LIMITS.maxNoticeLength).nullable(),
  markdown: z.string().min(1).max(Math.max(
    PAPER_TASK_TRANSLATION_LIMITS.maxMarkdownLength,
    PAPER_TASK_READING_LIMITS.maxMarkdownLength,
  )),
  assets: z.array(paperTaskControlledAssetSchema).max(PAPER_TASK_TRANSLATION_LIMITS.maxAssets).readonly(),
  formats: formatStatesSchema,
}).strict().readonly()

export const paperTaskReaderViewSchema = z.object({
  taskId: z.string().uuid(),
  branches: z.object({
    translation: paperTaskStateSchema,
    'deep-reading': paperTaskStateSchema,
  }).strict().readonly(),
  documents: z.array(readerDocumentSchema)
    .max(PAPER_TASK_READER_LIMITS.maxDocuments)
    .readonly(),
  pdfs: z.object({
    original: pdfStateSchema,
    translated: pdfStateSchema,
  }).strict().readonly(),
}).strict().readonly()

export type PaperTaskReaderView = z.infer<typeof paperTaskReaderViewSchema>
export type PaperTaskReaderDocument = PaperTaskReaderView['documents'][number]
export type PaperTaskReaderAsset = PaperTaskReaderDocument['assets'][number]
export type PaperTaskReaderFormatState = z.infer<typeof formatStateSchema>
export type PaperTaskReaderFormats = z.infer<typeof formatStatesSchema>

export function projectPaperTaskReaderView(
  payload: unknown,
  expectedTaskId: string,
): PaperTaskReaderView | null {
  const view = paperTaskReaderViewSchema.safeParse(payload)
  if (!view.success || view.data.taskId !== expectedTaskId) {
    return null
  }
  return view.data
}

export function paperTaskReaderPath(taskId: string): string {
  return `/api/prototype/paper-task/${taskId}/reader`
}

/**
 * One PDF route for both open and download. They address the same retained
 * file; `download` only changes the response disposition.
 */
export function paperTaskPdfPath(
  taskId: string,
  kind: PaperTaskPdfKind,
  action: 'open' | 'download',
): string {
  const base = `/api/prototype/paper-task/${taskId}/pdf/${kind}`
  return action === 'download' ? `${base}?download=1` : base
}

/** Explicit branch-local build action. The body selects formats independently. */
export function paperTaskArtifactsPath(taskId: string): string {
  return `/api/prototype/paper-task/${taskId}/artifacts`
}

/** One retained artifact path for inspection and final retrieval. */
export function paperTaskArtifactPath(
  taskId: string,
  branch: PaperTaskReaderBranch,
  format: PaperTaskExportFormat,
  options: { readonly download?: boolean; readonly inspection?: boolean; readonly artifactSha256?: string } = {},
): string {
  const query = new URLSearchParams()
  if (options.inspection === true) query.set('inspection', '1')
  if (options.artifactSha256 !== undefined) query.set('artifactSha256', options.artifactSha256)
  if (options.download === true) query.set('download', '1')
  const suffix = query.size === 0 ? '' : `?${query.toString()}`
  return `/api/prototype/paper-task/${taskId}/artifacts/${branch}/${format}${suffix}`
}

export function paperTaskArtifactInspectionPath(
  taskId: string,
  branch: PaperTaskReaderBranch,
  format: 'pdf',
): string {
  return `/api/prototype/paper-task/${taskId}/artifacts/${branch}/${format}/inspection`
}
