import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  GlobalWorkerOptions,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PaperTaskSourceFailureCode, PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import { extractSourceRecords } from './source-extract'
import { renderSourceAssets } from './source-crops'

const requireFromProject = createRequire(resolve(process.cwd(), 'package.json'))
GlobalWorkerOptions.workerSrc = pathToFileURL(requireFromProject.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
const standardFontDataUrl = join(dirname(requireFromProject.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll('\\', '/') + '/'

function errorCode(error: unknown): PaperTaskSourceFailureCode {
  if (error instanceof PasswordException) return 'encrypted'
  if (error instanceof InvalidPDFException) return 'invalid-pdf'
  if (error instanceof Error) return 'read-failed'
  throw error
}

export async function preparePaperTaskSource(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<PaperTaskSourceResult> {
  if (signal?.aborted) return { success: false, error: { code: 'cancelled' } }
  if (bytes.length === 0) return { success: false, error: { code: 'empty-input' } }
  const loadingTask: PDFDocumentLoadingTask = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl })
  let aborted = false
  const onAbort = (): void => {
    aborted = true
    void loadingTask.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const document = await loadingTask.promise
    if (aborted || signal?.aborted) return { success: false, error: { code: 'cancelled' } }
    const source = await extractSourceRecords(document)
    if (aborted || signal?.aborted) return { success: false, error: { code: 'cancelled' } }
    const assets = await renderSourceAssets(document, source.records, signal)
    if (aborted || signal?.aborted) return { success: false, error: { code: 'cancelled' } }
    const missingAsset = assets.some((asset) => asset.availability === 'unavailable')
    return {
      success: true,
      source: missingAsset && source.status !== 'incomplete'
        ? { ...source, status: 'incomplete' }
        : source,
      assets,
    }
  } catch (error) {
    return { success: false, error: { code: aborted || signal?.aborted ? 'cancelled' : errorCode(error) } }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await loadingTask.destroy()
  }
}
