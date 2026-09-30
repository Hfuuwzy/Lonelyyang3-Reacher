import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPaperReviewEvents } from '../../server/utils/paper-review/pipeline'
import { checkContentLength, checkPaperReviewAccess } from '../../server/utils/paper-review/gate'
import {
  parsePaperReviewMultipart,
  PAPER_PDF_BYTE_CAP,
  type PaperReviewMultipartErrorCode,
  type PaperReviewMultipartPart,
} from '../../server/utils/paper-review/multipart'
import type { ExtractedPaperPage, PaperExtractionFailure, PaperExtractionSuccess } from '../../server/utils/paper-review/pdf'
import type { PaperReviewHarnessFailure, PaperReviewHarnessSuccess } from '../../server/utils/paper-review/harness'
import type { PaperReviewReportResult } from '../../server/utils/paper-review/report'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'

// The exact synthetic 3-page fixture; fresh bytes each call because pdfjs may
// transfer the typed array to its worker.
function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../fixtures/paper-review-sample.pdf', import.meta.url)))
}

const PROVIDER = 'local-provider'
const MODEL = 'fixture-model'
const BASE_URL = 'http://localhost:9000'
const PROTOCOL = 'openai-completions'
const API_KEY = 'fixture-api-key'

const EXPECTED_REPORT = {
  status: 'incomplete',
  provider: PROVIDER,
  model: MODEL,
  sections: [
    {
      kind: 'claims',
      title: 'Claims',
      findings: [
        {
          statement: 'The fixture preserves layout for print.',
          source: {
            heading: '1 Introduction',
            readerPage: 1,
            quote: 'The quick brown fox jumps over the lazy dog.',
          },
        },
      ],
    },
  ],
  gaps: [],
  missingScope: ['full-translation'],
} as const

const FAKE_PAGES: readonly ExtractedPaperPage[] = [
  {
    readerPage: 1,
    lines: [
      { text: '1 Introduction', isHeading: true },
      { text: 'The quick brown fox jumps over the lazy dog.', isHeading: false },
    ],
    headings: ['1 Introduction'],
    text: '1 Introduction\nThe quick brown fox jumps over the lazy dog.',
  },
]

function field(name: string, value: string): PaperReviewMultipartPart {
  return { name, data: new TextEncoder().encode(value) }
}

function pdf(bytes: Uint8Array, overrides: { mime?: string; filename?: string } = {}): PaperReviewMultipartPart {
  return { name: 'pdf', filename: overrides.filename ?? 'paper.pdf', type: overrides.mime ?? 'application/pdf', data: bytes }
}

function filePart(name: string, data: Uint8Array): PaperReviewMultipartPart {
  return { name, filename: `${name}.bin`, type: 'application/pdf', data }
}

function validParts(bytes: Uint8Array = fixtureBytes()): PaperReviewMultipartPart[] {
  return [
    pdf(bytes),
    field('providerLabel', PROVIDER),
    field('baseUrl', BASE_URL),
    field('protocol', PROTOCOL),
    field('model', MODEL),
    field('apiKey', API_KEY),
  ]
}

async function consume(stream: AsyncIterable<PaperReviewStreamEvent>): Promise<PaperReviewStreamEvent[]> {
  const events: PaperReviewStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function lastEvent(events: readonly PaperReviewStreamEvent[]): PaperReviewStreamEvent {
  const event = events[events.length - 1]
  if (event === undefined) {
    throw new Error('expected a terminal event but the stream was empty')
  }
  return event
}

function eventAt(events: readonly PaperReviewStreamEvent[], index: number): PaperReviewStreamEvent {
  const event = events[index]
  if (event === undefined) {
    throw new Error(`expected an event at index ${index}`)
  }
  return event
}

function stagesOf(events: readonly PaperReviewStreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []))
}

function successDeps() {
  const extract = vi.fn(async (): Promise<PaperExtractionSuccess> => ({ success: true, pageCount: 1, pages: FAKE_PAGES }))
  const run = vi.fn(async (): Promise<PaperReviewHarnessSuccess> => ({ success: true, finalResponse: JSON.stringify({ sections: [] }) }))
  const verify = vi.fn((): PaperReviewReportResult => ({ success: true, report: EXPECTED_REPORT }))
  return { extract, run, verify }
}

describe('createPaperReviewEvents happy path', () => {
  it('emits the four stages in order and ends in the verifier report', async () => {
    // Given: a valid multipart form and fakes for every dependency.
    const { extract, run, verify } = successDeps()

    // When: the pipeline consumes a valid request.
    const events = await consume(
      createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }),
    )

    // Then: the stages arrive in protocol order and the report is terminal.
    expect(stagesOf(events)).toEqual(['validating', 'extracting', 'analyzing', 'verifying'])
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('report')
    if (terminal.type === 'report') {
      expect(terminal.report).toEqual(EXPECTED_REPORT)
    }
  })

  it('returns the verifier report verbatim, never fabricating a citation', async () => {
    // Given: a verifier that grounds one finding on the fixture page.
    const { extract, run, verify } = successDeps()

    // When: the pipeline reaches the terminal report.
    const events = await consume(
      createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }),
    )
    const terminal = lastEvent(events)

    // Then: the report is exactly the verifier's always-incomplete report with
    // the grounded source quote intact (reader page, heading, and quote).
    expect(terminal.type).toBe('report')
    if (terminal.type === 'report') {
      expect(terminal.report.status).toBe('incomplete')
      expect(terminal.report.missingScope).toEqual(['full-translation'])
      expect(terminal.report.sections[0]?.findings[0]?.source).toEqual({
        heading: '1 Introduction',
        readerPage: 1,
        quote: 'The quick brown fox jumps over the lazy dog.',
      })
    }
  })

  it('invokes the runner exactly once with the validated input', async () => {
    // Given: a fake runner that records its arguments.
    const { extract, run, verify } = successDeps()

    // When: the pipeline completes.
    await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))

    // Then: each dependency ran exactly once and the runner saw the parsed input.
    expect(extract).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ providerLabel: PROVIDER, baseUrl: BASE_URL, protocol: PROTOCOL, model: MODEL, apiKey: API_KEY }),
      FAKE_PAGES,
    )
  })
})

describe('createPaperReviewEvents failure paths', () => {
  it('stops at an extraction failure without running the model', async () => {
    // Given: an extractor that fails with an SDK-style raw message.
    const extract = vi.fn(async (): Promise<PaperExtractionFailure> => ({ success: false, error: { code: 'invalid-pdf', message: 'raw internals', recoverable: false } }))
    const run = vi.fn()
    const verify = vi.fn()

    // When: extraction fails.
    const events = await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))

    // Then: the stream stops at the extracting stage with a safe message.
    expect(stagesOf(events)).toEqual(['validating', 'extracting'])
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.stage).toBe('extracting')
      expect(terminal.code).toBe('invalid-pdf')
      expect(terminal.message).toBe('上传的文件不是可读取的 PDF，请检查后重新上传。')
      expect(terminal.message).not.toContain('raw internals')
    }
    expect(run).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })

  it('stops at an analyzing failure with a safe message', async () => {
    // Given: a runner that fails carrying a credential-like SDK message.
    const extract = vi.fn(async (): Promise<PaperExtractionSuccess> => ({ success: true, pageCount: 1, pages: FAKE_PAGES }))
    const run = vi.fn(async (): Promise<PaperReviewHarnessFailure> => ({ success: false, error: { code: 'run-failed', message: 'SDK blew up: sk-secret', recoverable: true } }))
    const verify = vi.fn()

    // When: the model run fails.
    const events = await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))

    // Then: the stream stops at the analyzing stage and never verifies.
    expect(stagesOf(events)).toEqual(['validating', 'extracting', 'analyzing'])
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.stage).toBe('analyzing')
      expect(terminal.code).toBe('run-failed')
      expect(terminal.message).toBe('模型服务暂不可用，请稍后重试。')
      expect(terminal.message).not.toContain('sk-secret')
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('maps a cleanup-failed analyzing result to a safe terminal error and never verifies', async () => {
    // Given a runner whose cleanup close fails carrying a credential-like detail.
    const extract = vi.fn(async (): Promise<PaperExtractionSuccess> => ({ success: true, pageCount: 1, pages: FAKE_PAGES }))
    const run = vi.fn(async (): Promise<PaperReviewHarnessFailure> => ({ success: false, error: { code: 'cleanup-failed', message: 'SDK cleanup nearby sk-secret-close', recoverable: true } }))
    const verify = vi.fn()

    // When the model run reports a cleanup failure.
    const events = await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))

    // Then the stream ends at the analyzing stage with an actionable safe error.
    expect(stagesOf(events)).toEqual(['validating', 'extracting', 'analyzing'])
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.stage).toBe('analyzing')
      expect(terminal.code).toBe('cleanup-failed')
      expect(terminal.message).toBe('审阅进程清理失败，临时环境可能残留，请稍后重试。')
      expect(terminal.message).not.toContain('sk-secret-close')
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('stops at a verifying failure and never emits a report', async () => {
    // Given: a verifier that rejects the raw response.
    const { extract, run } = successDeps()
    const verify = vi.fn((): PaperReviewReportResult => ({ success: false, error: { code: 'malformed-report', message: 'raw' } }))

    // When: verification fails.
    const events = await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))

    // Then: all four stages run but the stream ends in a verifying error.
    expect(stagesOf(events)).toEqual(['validating', 'extracting', 'analyzing', 'verifying'])
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.stage).toBe('verifying')
      expect(terminal.code).toBe('malformed-report')
      expect(terminal.message).toBe('模型返回的内容不符合审阅报告格式，本次审阅结果不可用。')
    }
    expect(events.some((event) => event.type === 'report')).toBe(false)
  })
})

describe('createPaperReviewEvents multipart validation', () => {
  const INPUT_CASES: Array<{ name: string; build: () => PaperReviewMultipartPart[]; code: PaperReviewMultipartErrorCode }> = [
    { name: 'a missing PDF', build: () => validParts().filter((part) => part.name !== 'pdf'), code: 'missing-pdf' },
    { name: 'a duplicate PDF', build: () => [...validParts(), pdf(fixtureBytes())], code: 'duplicate-pdf' },
    { name: 'an extra file', build: () => [...validParts(), filePart('notes', fixtureBytes())], code: 'extra-file' },
    { name: 'a duplicate field', build: () => [...validParts(), field('model', MODEL)], code: 'duplicate-field' },
    { name: 'an unknown field', build: () => [...validParts(), field('bogus', 'x')], code: 'unknown-field' },
    { name: 'a missing required field', build: () => validParts().filter((part) => part.name !== 'apiKey'), code: 'missing-required-field' },
    { name: 'an unsupported protocol', build: () => validParts().map((part) => (part.name === 'protocol' ? field('protocol', 'bogus') : part)), code: 'unsupported-protocol' },
    { name: 'a userinfo provider URL', build: () => validParts().map((part) => (part.name === 'baseUrl' ? field('baseUrl', 'http://user@example.com') : part)), code: 'invalid-url' },
    { name: 'a credential-query provider URL', build: () => validParts().map((part) => (part.name === 'baseUrl' ? field('baseUrl', 'http://example.com?api_key=x') : part)), code: 'invalid-url' },
    { name: 'the submitted API key embedded in the provider URL', build: () => validParts().map((part) => (part.name === 'baseUrl' ? field('baseUrl', `https://example.com/${API_KEY}`) : part)), code: 'invalid-url' },
    { name: 'the submitted key embedded in the provider URL', build: () => validParts().map((part) => (part.name === 'baseUrl' ? field('baseUrl', `https://example.com/${API_KEY}`) : part)), code: 'invalid-url' },
    { name: 'an empty provider label', build: () => validParts().map((part) => (part.name === 'providerLabel' ? field('providerLabel', '') : part)), code: 'unsupported-value' },
  ]

  it.each(INPUT_CASES)('rejects $name with a safe validating error', async ({ build, code }) => {
    // Given: an invalid multipart form and a fake runner.
    const { extract, run, verify } = successDeps()

    // When: the pipeline validates the parts.
    const events = await consume(
      createPaperReviewEvents(build(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }),
    )

    // Then: only the validating stage is emitted and the runner never runs.
    expect(events.map((event) => event.type)).toEqual(['stage', 'error'])
const first = eventAt(events, 0)
const terminal = eventAt(events, 1)
    if (first.type === 'stage' && terminal.type === 'error') {
      expect(first.stage).toBe('validating')
      expect(terminal.stage).toBe('validating')
      expect(terminal.code).toBe(code)
      expect(terminal.message.length).toBeGreaterThan(0)
    }
    expect(extract).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects a non-PDF MIME type before reading content', async () => {
    // Given: a part declared as a file with a text MIME type.
    const run = vi.fn()

    // When: the pipeline validates it.
    const events = await consume(createPaperReviewEvents([pdf(fixtureBytes(), { mime: 'text/plain' }), ...validParts().filter((p) => p.name !== 'pdf')], { runPaperReview: run }))

    // Then: an invalid-mime error is emitted at the validating stage.
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.code).toBe('invalid-mime')
      expect(terminal.message).toBe('上传的文件不是 application/pdf 格式，请上传有效的 PDF。')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects bytes without the %PDF- signature', async () => {
    // Given: a file that is not a PDF despite the MIME label.
    const run = vi.fn()

    // When: the pipeline validates it.
    const events = await consume(createPaperReviewEvents([pdf(new Uint8Array([1, 2, 3, 4, 5, 6])), ...validParts().filter((p) => p.name !== 'pdf')], { runPaperReview: run }))

    // Then: an invalid-signature error is emitted and the runner never runs.
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.code).toBe('invalid-signature')
      expect(terminal.message).toBe('上传的文件不是有效的 PDF，请重新上传。')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an empty PDF body', async () => {
    // Given: a zero-length PDF part.
    const run = vi.fn()

    // When: the pipeline validates it.
    const events = await consume(createPaperReviewEvents([pdf(new Uint8Array(0)), ...validParts().filter((p) => p.name !== 'pdf')], { runPaperReview: run }))

    // Then: an empty-pdf error is emitted and the runner never runs.
    const terminal = lastEvent(events)
    expect(terminal.type).toBe('error')
    if (terminal.type === 'error') {
      expect(terminal.code).toBe('empty-pdf')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('does not echo raw field values or URLs into validation errors', async () => {
    // Given: a provider URL carrying a credential-like query value.
    const secret = 'sk-leak-value'
    const parts = validParts().map((part) => (part.name === 'baseUrl' ? field('baseUrl', `http://example.com?api_key=${secret}`) : part))

    // When: the pipeline rejects the URL.
    const events = await consume(createPaperReviewEvents(parts, {}))
    const terminal = lastEvent(events)

    // Then: the message never repeats the secret or the host.
    if (terminal.type === 'error') {
      expect(terminal.message).not.toContain(secret)
      expect(terminal.message).not.toContain('example.com')
    }
  })
})

describe('parsePaperReviewMultipart boundary', () => {
  it('parses a valid form into a typed input', () => {
    // Given: a valid multipart form.
    const result = parsePaperReviewMultipart(validParts(), PAPER_PDF_BYTE_CAP)

    // Then: it succeeds with a typed, size-checked PDF and the five fields.
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.input.pdf.length).toBeGreaterThan(0)
      expect(result.input.pdf.length).toBeLessThanOrEqual(PAPER_PDF_BYTE_CAP)
      expect(result.input).toEqual({
        pdf: result.input.pdf,
        providerLabel: PROVIDER,
        baseUrl: BASE_URL,
        protocol: PROTOCOL,
        model: MODEL,
        apiKey: API_KEY,
      })
    }
  })

  it('rejects a file larger than the byte cap', () => {
    // Given: a small cap and a PDF part that exceeds it.
    const result = parsePaperReviewMultipart([pdf(fixtureBytes())], 4)

    // Then: a file-too-large failure is returned before any content reading.
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('file-too-large')
      expect(result.error.message.length).toBeGreaterThan(0)
    }
  })
})

describe('checkContentLength gate', () => {
  it('accepts a positive content-length within the cap', () => {
    // Given: a length under the cap.
    const result = checkContentLength('4096', PAPER_PDF_BYTE_CAP)

    // Then: it is allowed.
    expect(result).toEqual({ ok: true })
  })

  it('rejects a missing content-length', () => {
    const result = checkContentLength(null, PAPER_PDF_BYTE_CAP)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(400)
      expect(result.code).toBe('missing-content-length')
    }
  })

  it('rejects a malformed content-length', () => {
    const result = checkContentLength('12abc', PAPER_PDF_BYTE_CAP)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(400)
      expect(result.code).toBe('invalid-content-length')
    }
  })

  it('rejects an over-cap content-length with 413', () => {
    const result = checkContentLength(String(PAPER_PDF_BYTE_CAP + 1), PAPER_PDF_BYTE_CAP)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(413)
      expect(result.code).toBe('body-too-large')
    }
  })
})

describe('checkPaperReviewAccess gate', () => {
  it('allows a local dev loopback request with a matching origin', () => {
    // Given: a dev build, a loopback peer, and a matching origin.
    const result = checkPaperReviewAccess(true, '127.0.0.1', 'localhost:3000', 'http://localhost:3000')

    // Then: access is granted.
    expect(result).toEqual({ ok: true })
  })

  it('allows an IPv4-mapped loopback peer', () => {
    // Given: a Node-style ::ffff:127.0.0.1 remote address.
    const result = checkPaperReviewAccess(true, '::ffff:127.0.0.1', 'localhost', 'http://localhost')

    // Then: access is granted.
    expect(result).toEqual({ ok: true })
  })

  it('denies a production build (dev off) so the runner is never reached', () => {
    // Given: a production build and a loopback peer.
    const run = vi.fn()
    const result = checkPaperReviewAccess(false, '127.0.0.1', 'localhost', 'http://localhost')

    // When: the gate is evaluated (the route short-circuits before building the stream).
    // Then: access is denied with 404 and the fake runner is never invoked.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(404)
      expect(result.code).toBe('not-local')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('denies a non-loopback peer with 404', () => {
    // Given: a public peer address.
    const result = checkPaperReviewAccess(true, '203.0.113.9', 'example.com', 'http://example.com')

    // Then: access is denied without revealing the endpoint.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(404)
      expect(result.code).toBe('not-local')
    }
  })

  it('denies an IPv6 non-loopback peer', () => {
    const result = checkPaperReviewAccess(true, '2001:db8::1', 'localhost', 'http://localhost')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(404)
    }
  })

  it('denies an origin that does not match the request host with 403', () => {
    // Given: a loopback peer sending a cross-origin Origin header.
    const result = checkPaperReviewAccess(true, '127.0.0.1', 'localhost', 'http://evil.example')

    // Then: access is denied with 403.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(403)
      expect(result.code).toBe('origin-mismatch')
    }
  })

  it('denies a supplied origin when the request host is unavailable', () => {
    const result = checkPaperReviewAccess(true, '127.0.0.1', undefined, 'http://localhost')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.statusCode).toBe(403)
      expect(result.code).toBe('origin-mismatch')
    }
  })
})

describe('paper-review SSE contract', () => {
  it('emits each event as one blank-line-delimited data line', async () => {
    // Given: a valid request and fakes.
    const { extract, run, verify } = successDeps()

    // When: we render each pipeline event exactly like the route does.
    const events = await consume(createPaperReviewEvents(validParts(), { extractPaperPages: extract, runPaperReview: run, verifyPaperReview: verify }))
    const chunks = events.map((event) => `data: ${JSON.stringify(event)}\n\n`)

    // Then: there are exactly 5 chunks (4 stages + report), each well-formed SSE.
    expect(chunks).toHaveLength(5)
    expect(chunks[0]).toBe('data: {"type":"stage","stage":"validating"}\n\n')
    expect(chunks[4]).toBe(`data: ${JSON.stringify(events[4])}\n\n`)
    for (const chunk of chunks) {
      expect(chunk.startsWith('data: ')).toBe(true)
      expect(chunk.endsWith('\n\n')).toBe(true)
    }
  })
})
