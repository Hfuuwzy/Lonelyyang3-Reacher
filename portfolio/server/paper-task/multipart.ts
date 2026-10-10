/**
 * Semantic multipart parser for the sample paper-task endpoint (issue #40).
 *
 * Recognises exactly two fields — a `pdf` file and a `selection` text field —
 * and rejects duplicate / unknown / missing fields, extra files, an empty PDF,
 * a MIME other than `application/pdf`, a missing `%PDF-` signature, oversized
 * files, and any selection outside the frozen wire vocabulary. No credentials
 * are accepted here. Input is parsed into a typed `PaperTaskMultipartInput`;
 * every failure is a safe, value-free message.
 */

import { PAPER_PDF_BYTE_CAP } from '../utils/paper-review/multipart'
import {
  PAPER_TASK_SELECTIONS,
  type PaperTaskSelection,
} from '../../app/utils/paper-task-contract'

/** A single multipart part, shaped to be structurally compatible with H3. */
export interface PaperTaskMultipartPart {
  readonly name?: string
  readonly filename?: string
  /** MIME content-type; H3 sets it only for file parts. */
  readonly type?: string
  readonly data: Uint8Array
}

export interface PaperTaskMultipartInput {
  readonly pdf: Uint8Array
  readonly selection: PaperTaskSelection
}

export type PaperTaskMultipartErrorCode =
  | 'duplicate-field'
  | 'unknown-field'
  | 'extra-file'
  | 'missing-pdf'
  | 'duplicate-pdf'
  | 'empty-pdf'
  | 'invalid-mime'
  | 'invalid-signature'
  | 'file-too-large'
  | 'missing-selection'
  | 'invalid-selection'

export interface PaperTaskMultipartError {
  readonly code: PaperTaskMultipartErrorCode
  readonly message: string
}

export type PaperTaskMultipartResult =
  | { readonly success: true; readonly input: PaperTaskMultipartInput }
  | { readonly success: false; readonly error: PaperTaskMultipartError }

function failure(code: PaperTaskMultipartErrorCode, message: string): PaperTaskMultipartResult {
  return { success: false, error: { code, message } }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const // %PDF

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === PDF_MAGIC[0] &&
    bytes[1] === PDF_MAGIC[1] &&
    bytes[2] === PDF_MAGIC[2] &&
    bytes[3] === PDF_MAGIC[3]
  )
}

function isPaperTaskSelection(value: string): value is PaperTaskSelection {
  return PAPER_TASK_SELECTIONS.some((selection) => selection === value)
}

/**
 * Parse and validate the raw multipart parts into a typed input. Any violation
 * of the two-field contract is an immediate typed failure; the PDF file and the
 * selection text are then validated for size, signature, MIME, and supported
 * values.
 */
export function parsePaperTaskMultipart(
  parts: readonly PaperTaskMultipartPart[],
  byteCap: number,
): PaperTaskMultipartResult {
  let pdf: Uint8Array | undefined
  let sawPdf = false
  let selection: string | undefined

  for (const part of parts) {
    const name = part.name ?? ''
    if (name === '') {
      return failure('unknown-field', '上传请求包含无法识别的字段，请检查后重新提交。')
    }

    const isFile = typeof part.filename === 'string' && part.filename.length > 0
    if (isFile) {
      if (name !== 'pdf') {
        return failure('extra-file', '仅支持上传一个 PDF 文件，请移除多余文件后重新提交。')
      }
      if (sawPdf) {
        return failure('duplicate-pdf', '仅支持上传一个 PDF 文件，请检查后重新提交。')
      }
      sawPdf = true
      const mime = ((part.type ?? '').split(';')[0] ?? '').trim().toLowerCase()
      if (mime !== 'application/pdf') {
        return failure('invalid-mime', '上传的文件不是 application/pdf 格式，请上传有效的 PDF。')
      }
      const bytes = part.data
      if (bytes.length > byteCap) {
        return failure('file-too-large', '上传的 PDF 文件过大，请压缩后重新提交。')
      }
      if (bytes.length === 0) {
        return failure('empty-pdf', 'PDF 文件内容为空，请重新上传有效的 PDF。')
      }
      if (!hasPdfSignature(bytes)) {
        return failure('invalid-signature', '上传的文件不是有效的 PDF，请重新上传。')
      }
      pdf = bytes
      continue
    }

    if (name !== 'selection') {
      return failure('unknown-field', '上传请求包含不支持的字段，请检查后重新提交。')
    }
    if (selection !== undefined) {
      return failure('duplicate-field', '上传请求包含重复字段，请检查后重新提交。')
    }
    selection = new TextDecoder().decode(part.data).trim()
  }

  if (pdf === undefined) {
    return failure('missing-pdf', '未提供 PDF 文件，请上传 PDF 后重新提交。')
  }
  if (selection === undefined || selection === '') {
    return failure('missing-selection', '缺少任务分支选择，请选择翻译、深读或两者后重新提交。')
  }
  if (!isPaperTaskSelection(selection)) {
    return failure('invalid-selection', '任务分支选择不受支持，请选择翻译、深读或两者。')
  }

  return {
    success: true,
    input: { pdf, selection },
  }
}
