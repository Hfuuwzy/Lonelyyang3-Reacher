import { describe, expect, it } from 'vitest'
import { runBoundedShards } from '../../server/paper-review-internal/bounded-prompts'
import { PROMPT_CHAR_BUDGET } from '../../server/paper-review-internal/batching'
import type { PaperReviewHarnessResult, PaperReviewRunInput } from '../../server/utils/paper-review/harness'

const INPUT: PaperReviewRunInput = {
  providerLabel: 'p',
  baseUrl: 'https://gateway.example/v1',
  protocol: 'openai-completions',
  model: 'm',
  apiKey: 'k',
}
const INVOCATION = { input: INPUT, signal: undefined, stage: 'inventorying', purpose: 'inventory' } as const

const okResult: PaperReviewHarnessResult = { success: true, finalResponse: 'ok' }

describe('runBoundedShards exact prompt budget', () => {
  it('reports an over-budget prompt as oversize without a model call', async () => {
    // Given a prompt whose exact serialized length exceeds the budget.
    let calls = 0
    const run = async (): Promise<PaperReviewHarnessResult> => {
      calls += 1
      return okResult
    }
    // When the shard runner is invoked with that single over-budget prompt.
    const result = await runBoundedShards(run, INVOCATION, ['x'.repeat(PROMPT_CHAR_BUDGET + 1)])
    // Then it surfaces a typed oversize slot and never sends the prompt.
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.slots).toEqual([{ kind: 'oversize' }])
      expect(calls).toBe(0)
    }
  })

  it('preserves slot alignment so an oversize prompt never shifts later batches', async () => {
    const run = async (): Promise<PaperReviewHarnessResult> => okResult
    const result = await runBoundedShards(run, INVOCATION, [
      'small-1',
      'x'.repeat(PROMPT_CHAR_BUDGET + 1),
      'small-2',
    ])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.slots).toEqual([
        { kind: 'ok', text: 'ok' },
        { kind: 'oversize' },
        { kind: 'ok', text: 'ok' },
      ])
    }
  })

  it('localizes a non-fatal run failure to its own slot', async () => {
    const run = async (): Promise<PaperReviewHarnessResult> => ({
      success: false, error: { code: 'run-failed', message: 'x', recoverable: true },
    })
    const result = await runBoundedShards(run, INVOCATION, ['a', 'b'])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.slots).toEqual([{ kind: 'run-failed' }, { kind: 'run-failed' }])
    }
  })

  it('propagates a cleanup-failed fatal result', async () => {
    const run = async (): Promise<PaperReviewHarnessResult> => ({
      success: false, error: { code: 'cleanup-failed', message: 'x', recoverable: true },
    })
    const result = await runBoundedShards(run, INVOCATION, ['a'])
    expect(result.kind).toBe('fatal')
    if (result.kind === 'fatal') {
      expect(result.error.code).toBe('cleanup-failed')
      expect(result.error.stage).toBe('inventorying')
    }
  })
})