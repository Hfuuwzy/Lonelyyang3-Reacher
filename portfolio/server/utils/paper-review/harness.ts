import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { DeepSeekHarness, type DeepSeekHarnessOptions, type RunResult } from '@deepseek-ai/dsh-sdk-client'
import { defaultResolveLocalDshBin, type DshBinResolver } from './dsh-bin-resolver'
import { buildChildEnv, buildOverlayPatch, PAPER_REVIEW_ROUTE } from '../../paper-review-internal/harness-launch'
import { RUN_FAILED_MESSAGE, cancelledResult, toHarnessError, toRunOutcome } from '../../paper-review-internal/harness-outcomes'

export { buildChildEnv, buildOverlayPatch, RUN_FAILED_MESSAGE }

/**
 * App-owned Harness runner for one paper review (issue #27).
 *
 * Each invocation builds an isolated profile patch inside a fresh temp root,
 * launches exactly one `DeepSeekHarness` on profile `sdk-minimal`, runs one
 * prompt over per-page extracted text, returns the raw assistant response, and
 * closes and removes the temporary DSH_HOME on every success and failure. The
 * child environment is a strict allowlist — only required OS variables plus
 * `PAPER_REVIEW_API_KEY` — and the key is never written into the patch, the
 * prompt, or any returned error.
 */

/** The two wire protocols `dsh-llm-pi-ai` accepts for a hand-declared route. */
export const PAPER_REVIEW_PROTOCOLS = ['openai-completions', 'anthropic-messages'] as const
export type PaperReviewProtocol = (typeof PAPER_REVIEW_PROTOCOLS)[number]

export const PaperReviewRunInputSchema = z.object({
  providerLabel: z.string().min(1),
  baseUrl: z.string().min(1),
  protocol: z.enum(PAPER_REVIEW_PROTOCOLS),
  model: z.string().min(1),
  apiKey: z.string().min(1),
})
export type PaperReviewRunInput = z.infer<typeof PaperReviewRunInputSchema>

export type PaperReviewHarnessErrorCode =
  | 'invalid-input'
  | 'cli-not-found'
  | 'version-mismatch'
  | 'cli-not-built'
  | 'run-failed'
  | 'cleanup-failed'
  | 'cancelled'

/** Fixed, safe, actionable text for a cleanup failure; never carries SDK detail. */
export const CLEANUP_FAILED_MESSAGE =
  'The review session cleanup failed; the temporary environment may be incomplete. Please try again later.'

export interface PaperReviewHarnessError {
  readonly code: PaperReviewHarnessErrorCode
  readonly message: string
  readonly recoverable: boolean
}

export interface PaperReviewHarnessSuccess {
  readonly success: true
  /** Raw assistant text of the single run; the separate verifier consumes it. */
  readonly finalResponse: string
}

export interface PaperReviewHarnessFailure {
  readonly success: false
  readonly error: PaperReviewHarnessError
}

export type PaperReviewHarnessResult = PaperReviewHarnessSuccess | PaperReviewHarnessFailure

/** Minimal run surface a harness must satisfy; the real `DeepSeekHarness` fits. */
export interface HarnessLike {
  run(input: string, options?: { readonly sessionId?: string }): Promise<Pick<RunResult, 'sessionId' | 'finalResponse' | 'events'>>
  close(): Promise<void>
}

/** Constructs a harness from launch options; the test seam. */
export interface HarnessFactory {
  (options: DeepSeekHarnessOptions): HarnessLike
}

/** Injectable seams for the runner; each defaults to the real implementation. */
export interface PaperReviewRunnerDependencies {
  readonly harnessFactory?: HarnessFactory
  /** Resolve the local fork's built dsh CLI for this launch (default: repo layout). */
  readonly resolveLocalDshBin?: DshBinResolver
  /** Create a fresh isolated temp home for the child (default: mkdtemp under tmpdir). */
  readonly createTempRoot?: () => string
  /** Remove a temp home created by createTempRoot (default: recursive rmSync). */
  readonly removeTempRoot?: (root: string) => void
}

/** Per-invocation lifecycle knobs (e.g. a disconnect/cancel signal). */
export interface PaperReviewRunOptions {
  readonly signal?: AbortSignal
}

export interface PaperReviewModelRequest {
  readonly purpose: 'inventory' | 'report' | 'translation' | 'source-review'
  readonly prompt: string
}

const defaultHarnessFactory: HarnessFactory = (options) => new DeepSeekHarness(options)
const defaultCreateTempRoot: () => string = () => mkdtempSync(join(tmpdir(), 'paper-review-'))
const defaultRemoveTempRoot: (root: string) => void = (root) => rmSync(root, { recursive: true, force: true })

/**
 * Run one paper review through a fresh isolated Harness.
 * @param input - the validated provider/model configuration and API key.
 * @param request - purpose and exact application-owned prompt.
 * @param dependencies - injectable seams (defaults to the real SDK factory).
 * @param options - per-invocation lifecycle knobs. When `options.signal`
 *   aborts, the in-flight run is settled, the one owned dsh child is closed via
 *   a memoized `close()`, and the temporary home is removed before returning a
 *   terminal `cancelled` result (unless cleanup itself failed, which wins).
 * @returns the raw assistant response, or a typed key-free failure.
 */
export async function runPaperReview(
  input: PaperReviewRunInput,
  request: PaperReviewModelRequest,
  dependencies: PaperReviewRunnerDependencies = {},
  options: PaperReviewRunOptions = {},
): Promise<PaperReviewHarnessResult> {
  const parsed = PaperReviewRunInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: { code: 'invalid-input', message: 'Paper review input is invalid.', recoverable: true },
    }
  }

  const signal = options.signal
  // A pre-aborted signal allocates no temp home and no child process.
  if (signal?.aborted) {
    return cancelledResult()
  }

  const harnessFactory = dependencies.harnessFactory ?? defaultHarnessFactory
  const resolveDshBin = dependencies.resolveLocalDshBin ?? defaultResolveLocalDshBin
  const createTempRoot = dependencies.createTempRoot ?? defaultCreateTempRoot
  const removeTempRoot = dependencies.removeTempRoot ?? defaultRemoveTempRoot
  const resolution = resolveDshBin(process.cwd())
  if (!resolution.ok) {
    return {
      success: false,
      error: { code: resolution.error.code, message: resolution.error.message, recoverable: true },
    }
  }
  if (signal?.aborted) {
    return cancelledResult()
  }

  let tempRoot: string
  try {
    tempRoot = createTempRoot()
  } catch (error) {
    // No root was allocated, so there is nothing to close or remove: a failed
    // temp-home allocation is a typed run failure, never a rejected promise.
    return { success: false, error: toHarnessError(error) }
  }
  let harness: HarnessLike | undefined
  let cleanupFailed = false
  let aborted = false
  let closedPromise: Promise<void> | undefined
  // Memoized close: exactly one `close()` regardless of how many times abort
  // fires or how the reaped run rejects afterwards.
  const memoizedClose = (): Promise<void> => {
    const currentHarness = harness
    if (currentHarness === undefined) {
      return Promise.resolve()
    }
    closedPromise ??= Promise.resolve()
      .then(() => currentHarness.close())
      .then(
        () => undefined,
        () => { cleanupFailed = true },
      )
    return closedPromise
  }

  // Resolves the run/abort race the moment the caller's signal aborts.
  let settleAbort: (() => void) | undefined
  const abortSettle = new Promise<{ readonly kind: 'cancelled' }>((resolve) => {
    settleAbort = () => resolve({ kind: 'cancelled' })
  })
  const onAbort = (): void => {
    aborted = true
    void memoizedClose()
    settleAbort?.()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
  }

  let result: PaperReviewHarnessResult
  try {
    if (aborted) {
      result = cancelledResult()
    } else {
      const patchPath = join(tempRoot, 'overlay.cordis.yml')
      writeFileSync(patchPath, buildOverlayPatch(parsed.data))

      harness = harnessFactory({
        profile: 'sdk-minimal',
        patches: [patchPath],
        dshHome: tempRoot,
        processCwd: tempRoot,
        cwd: tempRoot,
        provider: PAPER_REVIEW_ROUTE,
        model: parsed.data.model,
        env: buildChildEnv(parsed.data.apiKey),
        dshBin: resolution.dshBin,
      })

      if (aborted) {
        result = cancelledResult()
      } else {
        // No session id: the SDK mints one fresh session per invocation.
        // The SDK has no run-level signal; close() terminates the child.
        const runOutcome = harness.run(request.prompt).then(
          (runResult) => ({ kind: 'result' as const, runResult }),
          (error: unknown) => ({ kind: 'failure' as const, error }),
        )
        const outcome = await Promise.race([runOutcome, abortSettle])
        if (outcome.kind === 'cancelled') {
          result = cancelledResult()
        } else if (outcome.kind === 'failure') {
          result = aborted
            ? cancelledResult()
            : { success: false, error: toHarnessError(outcome.error) }
        } else {
          result = toRunOutcome(outcome.runResult)
        }
      }
    }
  } catch (error) {
    if (aborted) {
      // The abort settled the race, or the reaped run rejected. Cancellation is
      // terminal unless cleanup also fails (checked after the finally block).
      result = cancelledResult()
    } else {
      result = { success: false, error: toHarnessError(error) }
    }
  } finally {
    // Keep observing disconnects while close is in flight: terminal success is
    // not returned until the child is reaped and the isolated home is removed.
    await memoizedClose()
    signal?.removeEventListener('abort', onAbort)
    try {
      removeTempRoot(tempRoot)
    } catch {
      cleanupFailed = true
    }
  }

  if (cleanupFailed) {
    return { success: false, error: { code: 'cleanup-failed', message: CLEANUP_FAILED_MESSAGE, recoverable: true } }
  }
  if (aborted) {
    return cancelledResult()
  }
  return result
}
