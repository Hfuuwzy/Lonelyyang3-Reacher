/**
 * Internal outcome/result helpers for the paper-review event pipeline (issues
 * #27/#28/#29).
 *
 * Lives outside `server/utils` so Nuxt's auto-import scanner never sees these
 * pure helpers; the pipeline facade imports them directly. Nothing here drives
 * stage orchestration — these are the unchanged message maps, cancellation /
 * signal checks, purpose-failure helpers, the per-unit translation completeness
 * check, and the task-result artifact assembly.
 */

import type {
  PaperReviewErrorEvent,
  PaperReviewReport,
  PaperReviewStage,
} from '../../app/utils/paper-review-contract'
import type {
  PaperReviewTaskGap,
  PaperReviewTaskResult,
  PaperSourceInventory,
  PaperSourceReview,
  PaperSourceUnit,
  PaperTranslationPair,
} from '../../app/utils/paper-review-task-contract'
import { isTranslationEligible } from '../../app/utils/paper-review-task-contract'
import type {
  PaperReviewHarnessResult,
  PaperReviewModelRequest,
  PaperReviewRunnerDependencies,
  PaperReviewRunInput,
  PaperReviewRunOptions,
} from '../utils/paper-review/harness'
import { unitGap } from '../utils/paper-review/source-ledger'

export const EXTRACTION_MESSAGES: Record<string, string> = {
  'empty-input': 'PDF 文件为空，请重新上传。',
  'invalid-pdf': '上传的文件不是可读取的 PDF，请检查后重新上传。',
  encrypted: 'PDF 已加密，请提供未加密的 PDF。',
  'no-text': 'PDF 没有可提取的文本，可能是扫描件或图片，本次无法审阅。',
  'read-failed': 'PDF 文本提取过程中发生错误，请重新上传。',
}

export const HARNESS_MESSAGES: Record<string, string> = {
  'invalid-input': '审阅参数无效，请检查后重新提交。',
  'cli-not-found': '本地的 Harness CLI 未就绪，请重新安装依赖或恢复源码后再试。',
  'version-mismatch': '本地的 Harness CLI 版本与应用 SDK 不一致，请重新构建后重试。',
  'cli-not-built': '本地的 Harness CLI 尚未构建，请先构建后再试。',
  'run-failed': '模型服务暂不可用，请稍后重试。',
  'cleanup-failed': '审阅进程清理失败，临时环境可能残留，请稍后重试。',
  'cancelled': '本次审阅任务已取消，请重新提交。',
}

export const VERIFY_MESSAGES: Record<string, string> = {
  'malformed-json': '模型返回的内容不是有效 JSON，本次审阅结果不可用。',
  'malformed-report': '模型返回的内容不符合审阅报告格式，本次审阅结果不可用。',
}

const CANCELLED_MESSAGE = '连接已断开，本次审阅已取消，请重新提交。'

export function safeMessage(map: Record<string, string>, code: string, fallback: string): string {
  return map[code] ?? fallback
}

export function cancelled(stage: PaperReviewStage): PaperReviewErrorEvent {
  return { type: 'error', stage, code: 'cancelled', message: CANCELLED_MESSAGE }
}

/** Fresh read of the lifecycle signal; bypasses control-flow narrowing so a
 * signal that aborts mid-run is always observed at the next check. */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

export interface PaperReviewModelInvocation {
  readonly input: PaperReviewRunInput
  readonly request: PaperReviewModelRequest
  readonly signal: AbortSignal | undefined
  readonly stage: PaperReviewStage
}

/**
 * Run one purpose-keyed model request, observing cancellation at both stage
 * boundaries and after the await. A Harness failure maps to a safe error event
 * at the active stage; a cancelled lifecycle signal wins over any pending/completed run,
 * except a `cleanup-failed` Harness result, which is preserved over cancellation.
 */
export async function runModelRequest(
  run: (
    input: PaperReviewRunInput,
    request: PaperReviewModelRequest,
    deps?: PaperReviewRunnerDependencies,
    options?: PaperReviewRunOptions,
  ) => Promise<PaperReviewHarnessResult>,
  invocation: PaperReviewModelInvocation,
): Promise<{ readonly kind: 'ok'; readonly finalResponse: string } | { readonly kind: 'error'; readonly error: PaperReviewErrorEvent }> {
  const { input, request, signal, stage } = invocation
  if (isAborted(signal)) {
    return { kind: 'error', error: cancelled(stage) }
  }
  const runResult = await run(input, request, undefined, { signal })
  // Preserve a `cleanup-failed` Harness result over a cancelled signal so a
  // cleanup failure surfacing as the run aborts is never masked by cancellation.
  if (isAborted(signal) && !(runResult.success === false && runResult.error.code === 'cleanup-failed')) {
    return { kind: 'error', error: cancelled(stage) }
  }
  if (!runResult.success) {
    return {
      kind: 'error',
      error: {
        type: 'error',
        stage,
        code: runResult.error.code,
        message: safeMessage(HARNESS_MESSAGES, runResult.error.code, '审阅运行失败，请重新提交。'),
      },
    }
  }
  return { kind: 'ok', finalResponse: runResult.finalResponse }
}

/**
 * An eligible source unit is only satisfied by exactly one nonblank accepted
 * translation; missing, blank, or duplicate records keep the task incomplete.
 */
function everyEligibleUnitHasOneNonblankPair(
  units: readonly PaperSourceUnit[],
  pairs: readonly PaperTranslationPair[],
): boolean {
  const eligible = units.filter(isTranslationEligible)
  return pairs.length === eligible.length && eligible.every((unit) => {
    const matches = pairs.filter((pair) => pair.unitId === unit.id)
    const chinese = matches[0]?.chinese
    return matches.length === 1 && chinese !== null && chinese !== undefined && chinese.trim() !== ''
  })
}

export function purposeFailureIsFatal(error: PaperReviewErrorEvent): boolean {
  return error.code === 'cancelled' || error.code === 'cleanup-failed'
}

export function failedPurposeGaps(
  artifact: PaperReviewTaskGap['artifact'],
  units: readonly PaperSourceUnit[],
  code: string,
  reason: string,
): readonly PaperReviewTaskGap[] {
  if (units.length === 0) {
    return [{ artifact, code, origin: 'application', unitIds: [], readerPages: [], spans: [], reason }]
  }
  return units.map((unit) => ({ ...unitGap(unit, artifact, code), reason }))
}

/**
 * Run one purpose's model shards sequentially, preserving every shard's
 * successful output. A fatal shard (cancelled or cleanup-failed) aborts the
 * whole purpose with one error; an ordinary run failure localizes to that shard
 * as `null` so earlier successful batches are preserved.
 */
export async function runPurposeShards(
  run: (
    input: PaperReviewRunInput,
    request: PaperReviewModelRequest,
    deps?: PaperReviewRunnerDependencies,
    options?: PaperReviewRunOptions,
  ) => Promise<PaperReviewHarnessResult>,
  invocation: { readonly input: PaperReviewRunInput; readonly signal: AbortSignal | undefined; readonly stage: PaperReviewStage; readonly purpose: PaperReviewModelRequest['purpose'] },
  prompts: readonly string[],
): Promise<{ readonly kind: 'ok'; readonly responses: readonly (string | null)[] } | { readonly kind: 'fatal'; readonly error: PaperReviewErrorEvent }> {
  const { input, signal, stage, purpose } = invocation
  const responses: (string | null)[] = []
  for (const prompt of prompts) {
    if (isAborted(signal)) {
      return { kind: 'fatal', error: cancelled(stage) }
    }
    const runResult = await runModelRequest(run, { input, request: { purpose, prompt }, signal, stage })
    if (runResult.kind === 'error') {
      if (purposeFailureIsFatal(runResult.error)) {
        return { kind: 'fatal', error: runResult.error }
      }
      responses.push(null)
    } else {
      responses.push(runResult.finalResponse)
    }
  }
  return { kind: 'ok', responses }
}

export interface TaskArtifacts {
  readonly input: PaperReviewRunInput
  readonly source: PaperSourceInventory
  readonly report: PaperReviewReport | null
  readonly pairs: readonly PaperTranslationPair[]
  readonly review: PaperSourceReview
  readonly gaps: readonly PaperReviewTaskGap[]
}

export function makeTaskResult(artifacts: TaskArtifacts): PaperReviewTaskResult {
  const eligible = artifacts.source.units.filter(isTranslationEligible)
  const gaps = [...artifacts.gaps]
  if (eligible.length === 0) {
    gaps.push({
      artifact: 'translation',
      code: 'no-eligible-units',
      origin: 'application',
      unitIds: [],
      readerPages: [],
      spans: [],
      reason: 'PDF 范围内没有可翻译的正文段落、标题或图注。',
    })
  }
  const report = artifacts.report === null
    ? null
    : { sections: artifacts.report.sections, gaps: artifacts.report.gaps }
  const complete = report !== null
    && report.gaps.length === 0
    && gaps.length === 0
    && everyEligibleUnitHasOneNonblankPair(artifacts.source.units, artifacts.pairs)
    && artifacts.review.status === 'passed'
    && artifacts.review.checks.length === artifacts.source.units.length
    && artifacts.review.checks.every((check) => check.verdict === 'passed')

  return {
    status: complete ? 'complete' : 'incomplete',
    provider: artifacts.input.providerLabel,
    model: artifacts.input.model,
    source: artifacts.source,
    report,
    translation: { pairs: artifacts.pairs, review: artifacts.review },
    gaps,
  }
}