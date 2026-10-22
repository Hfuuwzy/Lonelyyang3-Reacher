/**
 * Local paper-review CLI (issue #27).
 *
 * Arg parsing is fail-closed: only `--allow-paid` is accepted, it must be
 * present before any config is read or any review is run, and unknown
 * arguments are rejected. Config loading and running are injectable seams so
 * unit tests never read a real env file or make a paid Harness call. Every
 * user-facing line is a fixed, sanitized message — it never echoes a key, a
 * base URL, a PDF path, a config value, or an underlying exception.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseLocalConfig,
  type PaperReviewLocalConfig,
  type PaperReviewLocalConfigErrorCode,
} from './config'
import {
  runLocalReview,
  type PaperReviewLocalRunResult,
  type PaperReviewLocalRunSummary,
} from './runner'

export type PaperReviewLocalLoadErrorCode =
  | 'config-unreadable'
  | PaperReviewLocalConfigErrorCode

export type PaperReviewLocalLoadResult =
  | { readonly ok: true; readonly config: PaperReviewLocalConfig }
  | { readonly ok: false; readonly code: PaperReviewLocalLoadErrorCode }

export interface PaperReviewLocalCliOptions {
  readonly loadConfig?: () => PaperReviewLocalLoadResult
  readonly runReview?: (config: PaperReviewLocalConfig) => Promise<PaperReviewLocalRunResult>
  readonly cwd?: string
  readonly write?: (lines: readonly string[]) => void
}

/** The only accepted argument; required before config read / run. */
const ALLOWED_ARGS = new Set<string>(['--allow-paid'])

const MESSAGES = {
  title: 'paper-review:local',
  unknownArg: 'paper-review:local: unknown argument provided; the only accepted argument is --allow-paid.',
  requireAllowPaid: 'paper-review:local: --allow-paid is required before reading config or running a review (this incurs provider cost).',
  configUnreadable: 'paper-review:local: the local config file could not be read.',
  configMalformed: 'paper-review:local: the local config file is malformed.',
  configInvalid: 'paper-review:local: the local config is missing a required value or is otherwise invalid.',
  configLoadFailed: 'paper-review:local: the local config could not be loaded.',
  invalidBaseUrl: 'paper-review:local: the model base URL in the local config is invalid.',
  invalidProtocol: 'paper-review:local: the model protocol in the local config is unsupported.',
  pdfUnreadable: 'paper-review:local: the configured PDF could not be read.',
  runFailed: 'paper-review:local: the review run did not complete.',
} as const

type ArgParseResult = { readonly ok: true; readonly allowPaid: boolean } | { readonly ok: false; readonly code: 'unknown-arg' | 'require-allow-paid' }

function parseArgs(args: readonly string[]): ArgParseResult {
  if (args.length === 0) {
    return { ok: false, code: 'require-allow-paid' }
  }
  for (const arg of args) {
    if (!ALLOWED_ARGS.has(arg)) {
      return { ok: false, code: 'unknown-arg' }
    }
  }
  return { ok: true, allowPaid: args.includes('--allow-paid') }
}

function defaultLoadConfig(cwd: string): PaperReviewLocalLoadResult {
  const envPath = join(cwd, '.env.test.local')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return { ok: false, code: 'config-unreadable' }
  }
  return parseLocalConfig(raw, cwd)
}

/** Render the config/bootstrap error message mapped from a load error code. */
export function renderLoadFailure(code: PaperReviewLocalLoadErrorCode): readonly string[] {
  let message: string
  switch (code) {
    case 'config-unreadable':
      message = MESSAGES.configUnreadable
      break
    case 'config-malformed':
      message = MESSAGES.configMalformed
      break
    case 'invalid-base-url':
      message = MESSAGES.invalidBaseUrl
      break
    case 'invalid-protocol':
      message = MESSAGES.invalidProtocol
      break
    default:
      message = MESSAGES.configInvalid
  }
  return [MESSAGES.title, message]
}

/** Render the fixed sanitized message for an argument or run failure. */
export function renderFailure(code: 'unknown-arg' | 'require-allow-paid' | 'pdf-unreadable' | 'run-failed'): readonly string[] {
  let message: string
  switch (code) {
    case 'unknown-arg':
      message = MESSAGES.unknownArg
      break
    case 'require-allow-paid':
      message = MESSAGES.requireAllowPaid
      break
    case 'pdf-unreadable':
      message = MESSAGES.pdfUnreadable
      break
    default:
      message = MESSAGES.runFailed
  }
  return [MESSAGES.title, message]
}

/** Render a completed run: stages, then counts on success or an error code. */
export function renderRun(
  summary: PaperReviewLocalRunSummary,
  runCode?: 'pdf-unreadable' | 'run-failed',
): readonly string[] {
  if (runCode !== undefined) {
    return renderFailure(runCode)
  }
  const lines: string[] = [MESSAGES.title, `stages: ${summary.stages.join(' ')}`]
  if (!summary.ok) {
    lines.push(`error: ${summary.errorCode ?? 'review-failed'}`)
    return lines
  }
  lines.push(`status: ${summary.status ?? 'unknown'}`)
  if (summary.units !== undefined) {
    lines.push(`units: ${summary.units}`)
  }
  if (summary.pairs !== undefined) {
    lines.push(`pairs: ${summary.pairs}`)
  }
  if (summary.reportSections !== undefined) {
    lines.push(`reportSections: ${summary.reportSections}`)
  }
  if (summary.findings !== undefined) {
    lines.push(`findings: ${summary.findings}`)
  }
  if (summary.gaps !== undefined) {
    lines.push(`gaps: ${summary.gaps}`)
  }
  if (summary.reviewStatus !== undefined) {
    lines.push(`reviewStatus: ${summary.reviewStatus}`)
  }
  return lines
}

const INITIAL_SUMMARY_FOR_ERROR: PaperReviewLocalRunSummary = { ok: false, stages: [] }

/**
 * Run the local paper-review CLI. Returns the process exit code (0 on success,
 * nonzero on any gate, config, or run failure).
 */
export async function main(
  args: readonly string[],
  options: PaperReviewLocalCliOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const loadConfig = options.loadConfig ?? (() => defaultLoadConfig(cwd))
  const runReview = options.runReview ?? runLocalReview
  const write = options.write ?? ((lines: readonly string[]) => lines.forEach((line) => { console.log(line) }))

  const parsed = parseArgs(args)
  if (!parsed.ok) {
    write(renderFailure(parsed.code))
    return 1
  }
  if (!parsed.allowPaid) {
    write(renderFailure('require-allow-paid'))
    return 1
  }

  let loaded: PaperReviewLocalLoadResult
  try {
    loaded = loadConfig()
  } catch {
    write([MESSAGES.title, MESSAGES.configLoadFailed])
    return 1
  }
  if (!loaded.ok) {
    write(renderLoadFailure(loaded.code))
    return 1
  }

  let result: PaperReviewLocalRunResult
  try {
    result = await runReview(loaded.config)
  } catch {
    write(renderFailure('run-failed'))
    return 1
  }

  if (result.ok) {
    write(renderRun(result.summary))
    return result.summary.ok ? 0 : 1
  }
  write(renderRun(INITIAL_SUMMARY_FOR_ERROR, result.code))
  return 1
}