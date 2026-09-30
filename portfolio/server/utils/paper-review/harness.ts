import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { DeepSeekHarness, type DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import type { ExtractedPaperPage } from './pdf'
import { buildPaperReviewPrompt } from './prompt'
import { defaultResolveLocalDshBin, type DshBinResolver } from './dsh-bin-resolver'

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

/** Fixed provider route this runner selects on the inserted pi-ai adapter. */
const PAPER_REVIEW_ROUTE = 'paper-review'
/** Environment variable that carries the caller's key to the child process. */
const PAPER_REVIEW_KEY_ENV = 'PAPER_REVIEW_API_KEY'

export type PaperReviewHarnessErrorCode =
  | 'invalid-input'
  | 'cli-not-found'
  | 'version-mismatch'
  | 'cli-not-built'
  | 'run-failed'
  | 'cleanup-failed'

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
  run(input: string, options?: { readonly sessionId?: string }): Promise<{ readonly sessionId: string; readonly finalResponse: string }>
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
}

const defaultHarnessFactory: HarnessFactory = (options) => new DeepSeekHarness(options)
const defaultCreateTempRoot: () => string = () => mkdtempSync(join(tmpdir(), 'paper-review-'))

/** Render one interpolated YAML scalar safely (JSON is a YAML subset). */
function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/** The per-run overlay patch disabling the profile's tools and retry. */
export function buildOverlayPatch(input: PaperReviewRunInput): string {
  return [
    '# Per-run overlay on profile sdk-minimal (paper-review, issue #27).',
    '- id: persistent-bash',
    '  disabled: true',
    '- id: persistent-pwsh',
    '  disabled: true',
    '- id: mcp-resources',
    '  disabled: true',
    '- id: llm-retry',
    '  disabled: true',
    '- insert:',
    `    - id: llm-pi-ai`,
    `      name: ${yamlScalar('@deepseek-ai/dsh-llm-pi-ai')}`,
    '      config:',
    '        providers:',
    `          ${PAPER_REVIEW_ROUTE}:`,
    `            api: ${input.protocol}`,
    `            apiKeyEnv: ${PAPER_REVIEW_KEY_ENV}`,
    `            baseURL: ${yamlScalar(input.baseUrl)}`,
    '            models:',
    `              - id: ${yamlScalar(input.model)}`,
    '',
  ].join('\n')
}

/** Strict child-environment allowlist; never spreads the parent environment. */
export function buildChildEnv(apiKey: string): NodeJS.ProcessEnv {
  const parent = process.env
  const env: NodeJS.ProcessEnv = { PATH: parent.PATH, [PAPER_REVIEW_KEY_ENV]: apiKey }
  if (process.platform === 'win32') {
    env.SystemRoot = parent.SystemRoot
    env.TEMP = parent.TEMP
    env.TMP = parent.TMP
  } else {
    env.HOME = parent.HOME
    env.TMPDIR = parent.TMPDIR
  }
  return env
}

/** Map any thrown run/construction failure to a typed, key-free error. */
function toHarnessError(error: unknown): PaperReviewHarnessError {
  return {
    code: 'run-failed',
    message: error instanceof Error ? error.message : 'Harness run failed without a message.',
    recoverable: true,
  }
}

/**
 * Run one paper review through a fresh isolated Harness.
 * @param input - the validated provider/model configuration and API key.
 * @param pages - per-page extracted text and candidate headings.
 * @param dependencies - injectable seams (defaults to the real SDK factory).
 * @returns the raw assistant response, or a typed key-free failure.
 */
export async function runPaperReview(
  input: PaperReviewRunInput,
  pages: readonly ExtractedPaperPage[],
  dependencies: PaperReviewRunnerDependencies = {},
): Promise<PaperReviewHarnessResult> {
  const parsed = PaperReviewRunInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: { code: 'invalid-input', message: 'Paper review input is invalid.', recoverable: true },
    }
  }

  const harnessFactory = dependencies.harnessFactory ?? defaultHarnessFactory
  const resolveDshBin = dependencies.resolveLocalDshBin ?? defaultResolveLocalDshBin
  const createTempRoot = dependencies.createTempRoot ?? defaultCreateTempRoot
  const resolution = resolveDshBin(process.cwd())
  if (!resolution.ok) {
    return {
      success: false,
      error: { code: resolution.error.code, message: resolution.error.message, recoverable: true },
    }
  }
  const tempRoot = createTempRoot()
  let harness: HarnessLike | undefined
  let cleanupFailed = false

  let result: PaperReviewHarnessResult
  try {
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

    const prompt = buildPaperReviewPrompt({
      providerLabel: parsed.data.providerLabel,
      model: parsed.data.model,
      pages,
    })
    // No session id: the SDK mints one fresh session per invocation.
    const runResult = await harness.run(prompt)
    result = { success: true, finalResponse: runResult.finalResponse }
  } catch (error) {
    result = { success: false, error: toHarnessError(error) }
  } finally {
    // Close is part of cleanup; harvest a close failure so the temp tree is
    // removed no matter what, then return a typed cleanup-failed failure.
    if (harness !== undefined) {
      try {
        await harness.close()
      } catch {
        cleanupFailed = true
      }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }

  if (cleanupFailed) {
    return { success: false, error: { code: 'cleanup-failed', message: CLEANUP_FAILED_MESSAGE, recoverable: true } }
  }
  return result
}
