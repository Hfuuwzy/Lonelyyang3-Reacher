/**
 * Internal bounded-prompt shard runner for the paper-review pipeline (issue #29).
 *
 * Lives outside `server/utils` so Nuxt's auto-import scanner never treats it as
 * a composable. It runs one purpose's prompts sequentially while keeping two hard
 * guarantees independent of the rough partition estimate: every prompt's exact
 * serialized length is gated against a budget before it is sent, and a prompt
 * over that budget is reported as an `oversize` slot (never truncated, never
 * blindly sent). A run failure localizes to its slot; only cancellation or
 * cleanup-failure is fatal to the whole purpose.
 */

import type { PaperReviewErrorEvent, PaperReviewStage } from '../../app/utils/paper-review-contract'
import type {
  PaperReviewHarnessResult,
  PaperReviewModelRequest,
  PaperReviewRunnerDependencies,
  PaperReviewRunInput,
  PaperReviewRunOptions,
} from '../utils/paper-review/harness'
import { PROMPT_CHAR_BUDGET } from './batching'
import { runPurposeShards } from './pipeline-outcomes'

export type BoundedSlot =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'run-failed' }
  | { readonly kind: 'oversize' }

export type BoundedShardsResult =
  | { readonly kind: 'fatal'; readonly error: PaperReviewErrorEvent }
  | { readonly kind: 'ok'; readonly slots: readonly BoundedSlot[] }

/**
 * Run one purpose's built prompts sequentially, aligned one slot per prompt.
 * Prompts whose exact serialized length exceeds `budget` become `oversize` slots
 * without a model call; a successful call becomes `ok`; a non-fatal run failure
 * localizes as `run-failed`. Cancellation and cleanup-failure abort the whole
 * purpose with one error, preserving every earlier successful slot.
 */
export async function runBoundedShards(
  run: (
    input: PaperReviewRunInput,
    request: PaperReviewModelRequest,
    deps?: PaperReviewRunnerDependencies,
    options?: PaperReviewRunOptions,
  ) => Promise<PaperReviewHarnessResult>,
  invocation: { readonly input: PaperReviewRunInput; readonly signal: AbortSignal | undefined; readonly stage: PaperReviewStage; readonly purpose: PaperReviewModelRequest['purpose'] },
  prompts: readonly string[],
  budget = PROMPT_CHAR_BUDGET,
): Promise<BoundedShardsResult> {
  const runnableIndexes: number[] = []
  for (let index = 0; index < prompts.length; index += 1) {
    if (prompts[index]!.length <= budget) {
      runnableIndexes.push(index)
    }
  }
  const runResult = await runPurposeShards(
    run,
    invocation,
    runnableIndexes.map((index) => prompts[index]!),
  )
  if (runResult.kind === 'fatal') {
    return { kind: 'fatal', error: runResult.error }
  }
  const slots: BoundedSlot[] = []
  let runnable = 0
  for (let index = 0; index < prompts.length; index += 1) {
    if (!runnableIndexes.includes(index)) {
      slots.push({ kind: 'oversize' })
      continue
    }
    const response = runResult.responses[runnable]!
    runnable += 1
    slots.push(response === null ? { kind: 'run-failed' } : { kind: 'ok', text: response })
  }
  return { kind: 'ok', slots }
}