import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPaperPages, type PdfLoader } from '../../server/utils/paper-review/pdf'

describe('extractPaperPages cancellation', () => {
  it('does not load a document for a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await extractPaperPages(new Uint8Array([1]), controller.signal, () => {
      throw new Error('a pre-aborted extraction must not load the PDF')
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.code).toBe('cancelled')
  })

  it('destroys the pending PDF loading task once on abort', async () => {
    const controller = new AbortController()
    let rejectLoad!: (error: Error) => void
    let destroyCalls = 0
    const loader: PdfLoader = () => ({
      promise: new Promise<PDFDocumentProxy>((_resolve, reject) => { rejectLoad = reject }),
      destroy: () => {
        destroyCalls += 1
        rejectLoad(new Error('load stopped'))
      },
    })

    const pending = extractPaperPages(new Uint8Array([1]), controller.signal, loader)
    controller.abort()
    const result = await pending

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.code).toBe('cancelled')
    expect(destroyCalls).toBe(1)
  })
})
