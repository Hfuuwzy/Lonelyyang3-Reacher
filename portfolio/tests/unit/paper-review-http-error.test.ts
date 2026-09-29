import { describe, expect, it } from 'vitest'
import {
  PAPER_REVIEW_UPLOAD_LIMIT_MIB,
  paperReviewHttpErrorMessage,
} from '../../app/utils/paper-review-http-error'

describe('paper-review pre-stream HTTP error messages', () => {
  it('explains HTTP 400 as invalid or malformed upload parameters', () => {
    // Given an HTTP 400 rejection before multipart parsing.
    // When the status is mapped to user feedback.
    const message = paperReviewHttpErrorMessage(400)
    // Then the message names the upload-parameter cause instead of echoing a body.
    expect(message).toContain('HTTP 400')
    expect(message).toMatch(/上传参数/)
    expect(message).not.toMatch(/\b(sk-|key|token)\b/i)
  })

  it('explains HTTP 413 as exceeding the upload limit', () => {
    // Given an HTTP 413 over-limit rejection before multipart parsing.
    // When the status is mapped to user feedback.
    const message = paperReviewHttpErrorMessage(413)
    // Then the message names the 50 MiB cap exactly as the route enforces it.
    expect(message).toContain('HTTP 413')
    expect(message).toContain(`${PAPER_REVIEW_UPLOAD_LIMIT_MIB} MiB`)
    expect(message).toMatch(/超过/)
  })

  it('retains a safe generic message for any other status', () => {
    // Given an unexpected status that is neither pre-parse 400 nor over-limit 413.
    // When the status is mapped to user feedback.
    const message = paperReviewHttpErrorMessage(500)
    // Then the fallback names the HTTP status conversationally without specifics.
    expect(message).toContain('HTTP 500')
    expect(message).toMatch(/开发服务器正在运行/)
    expect(message).not.toContain('MiB')
  })

  it('maps every non-400/non-413 status to the generic copy, interpolating only the code', () => {
    // The mapping is a pure status → fixed-copy function: body text, headers,
    // and request fields are never read, so no untrusted data can be echoed.
    for (const status of [0, 204, 401, 403, 404, 429, 502, 503]) {
      expect(paperReviewHttpErrorMessage(status)).toContain(`HTTP ${status}`)
    }
  })
})