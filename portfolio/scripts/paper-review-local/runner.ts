/**
 * Local paper-review runner (issue #27).
 *
 * Builds the multipart parts from a validated local config plus the PDF bytes,
 * then drives the existing in-process `createPaperReviewEvents` pipeline (the
 * same multipart + Harness seam the server route uses) and collapses the stream
 * into a safe, countable summary. No report prose, PDF text, key, endpoint, or
 * path is ever surfaced — only stage names, the report status, and counts.
 *
 * `readPdf` and `createEvents` are injectable seams: unit tests substitute both
 * so no real file and no paid Harness call are ever made.
 */

import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'
import type {
  PaperReviewStreamEvent,
  PaperReviewStage,
} from '../../app/utils/paper-review-contract'
import type { PaperReviewLocalConfig } from './config'

export interface PaperReviewLocalRunSummary {
  readonly ok: boolean
  readonly stages: readonly PaperReviewStage[]
  readonly errorCode?: string
  readonly status?: 'complete' | 'incomplete'
  readonly units?: number
  readonly pairs?: number
  readonly reportSections?: number
  readonly findings?: number
  readonly gaps?: number
  readonly reviewStatus?: 'not-run' | 'incomplete' | 'passed'
}

export type PaperReviewLocalRunResult =
  | { readonly ok: true; readonly summary: PaperReviewLocalRunSummary }
  | { readonly ok: false; readonly code: 'pdf-unreadable' | 'run-failed' }

export interface PaperReviewLocalRunnerDependencies {
  readonly readPdf?: (pdfPath: string) => Promise<Uint8Array>
  readonly createEvents?: (
    parts: readonly PaperReviewMultipartPart[],
  ) => AsyncIterable<PaperReviewStreamEvent>
}

const INITIAL_SUMMARY: PaperReviewLocalRunSummary = Object.freeze({ ok: false, stages: [] })

/** Build the multipart parts the existing pipeline expects (pdf + 5 text fields). */
export function buildReviewParts(
  config: PaperReviewLocalConfig,
  pdf: Uint8Array,
): readonly PaperReviewMultipartPart[] {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
  return [
    { name: 'pdf', filename: 'paper.pdf', type: 'application/pdf', data: pdf },
    { name: 'providerLabel', data: encode(config.providerLabel) },
    { name: 'baseUrl', data: encode(config.baseUrl) },
    { name: 'protocol', data: encode(config.protocol) },
    { name: 'model', data: encode(config.modelId) },
    { name: 'apiKey', data: encode(config.apiKey) },
  ]
}

/** Fold one stream event into the running summary (stages, counts, or error). */
export function applyReviewEvent(
  summary: PaperReviewLocalRunSummary,
  event: PaperReviewStreamEvent,
): PaperReviewLocalRunSummary {
  switch (event.type) {
    case 'stage':
      return { ...summary, stages: [...summary.stages, event.stage] }
    case 'result': {
      const findings = event.result.report?.sections
        .reduce((total, section) => total + section.findings.length, 0) ?? 0
      return {
        ok: true,
        stages: summary.stages,
        status: event.result.status,
        units: event.result.source.units.length,
        pairs: event.result.translation.pairs.length,
        reportSections: event.result.report?.sections.length,
        findings,
        gaps: event.result.gaps.length,
        reviewStatus: event.result.translation.review.status,
      }
    }
    case 'error':
      return { ...summary, ok: false, errorCode: event.code }
  }
}

/** Default PDF reader; lazily loaded so the offline no-flag path stays light. */
async function defaultReadPdf(pdfPath: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises')
  return new Uint8Array(await readFile(pdfPath))
}

/** Default event source: the real in-process pipeline, loaded lazily. */
async function* defaultCreateEvents(
  parts: readonly PaperReviewMultipartPart[],
): AsyncIterable<PaperReviewStreamEvent> {
  const { createPaperReviewEvents } = await import('../../server/utils/paper-review/pipeline')
  yield* createPaperReviewEvents(parts)
}

/**
 * Run one local review. Any PDF read or pipeline exception is collapsed into a
 * sanitized typed failure so the caller never sees the underlying path/error.
 */
export async function runLocalReview(
  config: PaperReviewLocalConfig,
  dependencies: PaperReviewLocalRunnerDependencies = {},
): Promise<PaperReviewLocalRunResult> {
  const readPdf = dependencies.readPdf ?? defaultReadPdf
  const createEvents = dependencies.createEvents ?? defaultCreateEvents

  let pdf: Uint8Array
  try {
    pdf = await readPdf(config.pdfPath)
  } catch {
    return { ok: false, code: 'pdf-unreadable' }
  }

  const parts = buildReviewParts(config, pdf)
  let summary: PaperReviewLocalRunSummary = INITIAL_SUMMARY
  try {
    for await (const event of createEvents(parts)) {
      summary = applyReviewEvent(summary, event)
    }
  } catch {
    return { ok: false, code: 'run-failed' }
  }
  return { ok: true, summary }
}