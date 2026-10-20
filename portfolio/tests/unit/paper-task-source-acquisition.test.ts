import { describe, expect, it, vi } from 'vitest'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import { resolvePaperTaskSourceLink } from '../../server/paper-task/source-acquisition'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])

const COMPLETE_SOURCE: PaperTaskSourceResult = {
  success: true,
  source: {
    status: 'complete',
    pageCount: 1,
    records: [{
      id: 'p1-r0', order: 0, kind: 'body', text: 'A complete paper.', state: 'present', page: 1,
      bbox: [10, 20, 90, 12], sectionId: null, context: '', links: [],
    }],
  },
  assets: [],
}

function pdfResponse(bytes = PDF_BYTES): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.byteLength) },
  })
}

describe('resolvePaperTaskSourceLink', () => {
  it('downloads and prepares only the paper named by a supported arXiv link', async () => {
    const fetchSource = vi.fn(async () => pdfResponse())
    const prepare = vi.fn(async () => COMPLETE_SOURCE)

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/2404.05961v2', {
      fetch: fetchSource,
      prepare,
    })

    expect(result).toEqual({ kind: 'ready', pdf: PDF_BYTES, preparedSource: COMPLETE_SOURCE })
    expect(fetchSource).toHaveBeenCalledOnce()
    expect(String(fetchSource.mock.calls[0]?.[0])).toBe('https://arxiv.org/pdf/2404.05961v2')
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare.mock.calls[0]?.[0]).toEqual(PDF_BYTES)
  })

  it('supports a legacy arXiv paper identifier without searching for other versions or papers', async () => {
    const fetchSource = vi.fn(async () => pdfResponse())

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/cs/9901001', {
      fetch: fetchSource,
      prepare: async () => COMPLETE_SOURCE,
    })

    expect(result.kind).toBe('ready')
    expect(String(fetchSource.mock.calls[0]?.[0])).toBe('https://arxiv.org/pdf/cs/9901001')
  })

  it('does not treat a partially extracted paper as a reliable full text', async () => {
    const fetchSource = vi.fn(async () => pdfResponse())
    const partialSource: PaperTaskSourceResult = {
      ...COMPLETE_SOURCE,
      source: { ...COMPLETE_SOURCE.source, status: 'incomplete' },
    }

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/2404.05961', {
      fetch: fetchSource,
      prepare: async () => partialSource,
    })

    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('offers the upload fallback when the source cannot be fetched as a PDF', async () => {
    const fetchSource = vi.fn(async () => new Response('<html>not a PDF</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
    const prepare = vi.fn(async () => COMPLETE_SOURCE)

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/2404.05961', {
      fetch: fetchSource,
      prepare,
    })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('does not make a network request for a link outside the controlled source allowlist', async () => {
    const fetchSource = vi.fn(async () => pdfResponse())

    const result = await resolvePaperTaskSourceLink('https://example.org/private.pdf', {
      fetch: fetchSource,
      prepare: async () => COMPLETE_SOURCE,
    })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(fetchSource).not.toHaveBeenCalled()
  })

  it('rejects a redirect outside arXiv rather than following it', async () => {
    const fetchSource = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://example.org/private.pdf' },
    }))

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/2404.05961', {
      fetch: fetchSource,
      prepare: async () => COMPLETE_SOURCE,
    })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(fetchSource).toHaveBeenCalledOnce()
  })

  it('rejects a source response over the PDF size cap before extraction', async () => {
    const fetchSource = vi.fn(async () => new Response(PDF_BYTES, {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': '52428801' },
    }))
    const prepare = vi.fn(async () => COMPLETE_SOURCE)

    const result = await resolvePaperTaskSourceLink('https://arxiv.org/abs/2404.05961', {
      fetch: fetchSource,
      prepare,
    })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(prepare).not.toHaveBeenCalled()
  })
})
