/**
 * Event pipeline for the paper-review prototype (issue #27).
 *
 * `createPaperReviewEvents` is the internal seam tested with fakes. It emits
 * the four stage events in protocol order and ends with exactly one terminal
 * event: the verifier's `report` on success or a single `error` at the failing
 * stage. No later stage is emitted after a failure. The extractor, runner, and
 * verifier are dependency-injected so unit tests can replace them; production
 * defaults are the real modules.
 */

import type { PaperReviewStreamEvent } from '../../../app/utils/paper-review-contract'
import {
  extractPaperPages,
  type ExtractedPaperPage,
  type PaperExtractionResult,
} from './pdf'
import {
  runPaperReview,
  type PaperReviewHarnessResult,
  type PaperReviewRunnerDependencies,
  type PaperReviewRunInput,
} from './harness'
import {
  verifyPaperReview,
  type PaperReviewReportResult,
} from './report'
import {
  parsePaperReviewMultipart,
  PAPER_PDF_BYTE_CAP,
  type PaperReviewMultipartPart,
} from './multipart'

export interface PaperReviewPipelineDependencies {
  readonly extractPaperPages?: (bytes: Uint8Array) => Promise<PaperExtractionResult>
  readonly runPaperReview?: (
    input: PaperReviewRunInput,
    pages: readonly ExtractedPaperPage[],
    deps?: PaperReviewRunnerDependencies,
  ) => Promise<PaperReviewHarnessResult>
  readonly verifyPaperReview?: (
    raw: string,
    pages: readonly ExtractedPaperPage[],
    provider: string,
    model: string,
  ) => PaperReviewReportResult
}

const EXTRACTION_MESSAGES: Record<string, string> = {
  'empty-input': 'PDF 文件为空，请重新上传。',
  'invalid-pdf': '上传的文件不是可读取的 PDF，请检查后重新上传。',
  encrypted: 'PDF 已加密，请提供未加密的 PDF。',
  'no-text': 'PDF 没有可提取的文本，可能是扫描件或图片，本次无法审阅。',
  'read-failed': 'PDF 文本提取过程中发生错误，请重新上传。',
}

const HARNESS_MESSAGES: Record<string, string> = {
  'invalid-input': '审阅参数无效，请检查后重新提交。',
  'cli-not-found': '本地的 Harness CLI 未就绪，请重新安装依赖或恢复源码后再试。',
  'version-mismatch': '本地的 Harness CLI 版本与应用 SDK 不一致，请重新构建后重试。',
  'cli-not-built': '本地的 Harness CLI 尚未构建，请先构建后再试。',
  'run-failed': '模型服务暂不可用，请稍后重试。',
  'cleanup-failed': '审阅进程清理失败，临时环境可能残留，请稍后重试。',
}

const VERIFY_MESSAGES: Record<string, string> = {
  'malformed-json': '模型返回的内容不是有效 JSON，本次审阅结果不可用。',
  'malformed-report': '模型返回的内容不符合审阅报告格式，本次审阅结果不可用。',
}

function safeMessage(map: Record<string, string>, code: string, fallback: string): string {
  return map[code] ?? fallback
}

/**
 * Yield the full paper-review stream. Stage events are emitted just before each
 * dependency runs; the first failure stops the stream with one error event.
 */
export async function* createPaperReviewEvents(
  parts: readonly PaperReviewMultipartPart[],
  dependencies: PaperReviewPipelineDependencies = {},
): AsyncGenerator<PaperReviewStreamEvent> {
  const extract = dependencies.extractPaperPages ?? extractPaperPages
  const run = dependencies.runPaperReview ?? runPaperReview
  const verify = dependencies.verifyPaperReview ?? verifyPaperReview

  yield { type: 'stage', stage: 'validating' }

  const parsed = parsePaperReviewMultipart(parts, PAPER_PDF_BYTE_CAP)
  if (!parsed.success) {
    yield { type: 'error', stage: 'validating', code: parsed.error.code, message: parsed.error.message }
    return
  }
  const input = parsed.input

  yield { type: 'stage', stage: 'extracting' }
  const extraction = await extract(input.pdf)
  if (!extraction.success) {
    yield {
      type: 'error',
      stage: 'extracting',
      code: extraction.error.code,
      message: safeMessage(EXTRACTION_MESSAGES, extraction.error.code, 'PDF 处理失败，请重新提交。'),
    }
    return
  }

  yield { type: 'stage', stage: 'analyzing' }
  const runResult = await run(input, extraction.pages)
  if (!runResult.success) {
    yield {
      type: 'error',
      stage: 'analyzing',
      code: runResult.error.code,
      message: safeMessage(HARNESS_MESSAGES, runResult.error.code, '审阅运行失败，请重新提交。'),
    }
    return
  }

  yield { type: 'stage', stage: 'verifying' }
  const verifyResult = verify(runResult.finalResponse, extraction.pages, input.providerLabel, input.model)
  if (!verifyResult.success) {
    yield {
      type: 'error',
      stage: 'verifying',
      code: verifyResult.error.code,
      message: safeMessage(VERIFY_MESSAGES, verifyResult.error.code, '审阅结果验证失败，请重新提交。'),
    }
    return
  }

  yield { type: 'report', report: verifyResult.report }
}
