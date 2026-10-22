import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import {
  runPaperReview,
  type HarnessFactory,
  type PaperReviewRunInput,
} from '../../server/utils/paper-review/harness'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'

const INPUT: PaperReviewRunInput = {
  providerLabel: 'Local provider',
  baseUrl: 'https://gateway.example/v1',
  protocol: 'openai-completions',
  model: 'reviewer-test',
  apiKey: 'sk-paper-review-test',
}
const PAGES: readonly ExtractedPaperPage[] = []

function successfulRun() {
  return { sessionId: 'session', finalResponse: '{"sections":[]}', events: [] }
}

function okResolver() {
  return () => ({ ok: true as const, dshBin: join(tmpdir(), 'paper-review-test-dsh.js') })
}

describe('runPaperReview cancellation', () => {
  it('does not allocate a Harness or temp home for a pre-aborted task', async () => {
    const controller = new AbortController()
    controller.abort()
    let factoryCalls = 0
    let rootCalls = 0
    const factory: HarnessFactory = () => {
      factoryCalls += 1
      return { run: async () => successfulRun(), close: async () => {} }
    }

    const result = await runPaperReview(
      INPUT,
      PAGES,
      {
        harnessFactory: factory,
        resolveLocalDshBin: okResolver(),
        createTempRoot: () => {
          rootCalls += 1
          return join(tmpdir(), 'paper-review-pre-abort')
        },
      },
      { signal: controller.signal },
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.code).toBe('cancelled')
    expect(factoryCalls).toBe(0)
    expect(rootCalls).toBe(0)
  })

  it('closes its pending child before removing its home, then returns cancelled', async () => {
    const controller = new AbortController()
    let startRun!: () => void
    let resolveRun!: (result: ReturnType<typeof successfulRun>) => void
    let startClose!: () => void
    let finishClose!: () => void
    const runStarted = new Promise<void>((resolve) => { startRun = resolve })
    const closeStarted = new Promise<void>((resolve) => { startClose = resolve })
    const closeFinished = new Promise<void>((resolve) => { finishClose = resolve })
    const runPromise = new Promise<ReturnType<typeof successfulRun>>((resolve) => { resolveRun = resolve })
    const launches: DeepSeekHarnessOptions[] = []
    let closeCalls = 0
    const factory: HarnessFactory = (options) => {
      launches.push(options)
      return {
        run: () => {
          startRun()
          return runPromise
        },
        close: () => {
          closeCalls += 1
          startClose()
          return closeFinished
        },
      }
    }

    const pending = runPaperReview(
      INPUT,
      PAGES,
      { harnessFactory: factory, resolveLocalDshBin: okResolver() },
      { signal: controller.signal },
    )
    await runStarted
    controller.abort()
    await closeStarted

    const home = launches[0]?.dshHome
    expect(home).toBeDefined()
    expect(existsSync(home!)).toBe(true)
    resolveRun(successfulRun())
    finishClose()

    const result = await pending
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.code).toBe('cancelled')
    expect(closeCalls).toBe(1)
    expect(existsSync(home!)).toBe(false)
  })

  it('gives an explicit resubmission a fresh Harness, home, and implicit session', async () => {
    const homes: string[] = []
    const sessionOptions: Array<{ readonly sessionId?: string } | undefined> = []
    const factory: HarnessFactory = (options) => {
      homes.push(options.dshHome ?? '')
      return {
        run: async (_prompt, runOptions) => {
          sessionOptions.push(runOptions)
          return successfulRun()
        },
        close: async () => {},
      }
    }

    const first = await runPaperReview(INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver() })
    const second = await runPaperReview(INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver() })

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(homes).toHaveLength(2)
    expect(homes[0]).not.toBe(homes[1])
    expect(homes.every((home) => home !== '' && !existsSync(home))).toBe(true)
    expect(sessionOptions).toEqual([undefined, undefined])
  })
})
