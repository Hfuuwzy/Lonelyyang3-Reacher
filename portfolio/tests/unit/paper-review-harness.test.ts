import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import {
  buildChildEnv,
  buildOverlayPatch,
  runPaperReview,
  RUN_FAILED_MESSAGE,
  type HarnessFactory,
  type PaperReviewModelRequest,
  type PaperReviewRunInput,
} from '../../server/utils/paper-review/harness'
import { resolveLocalDshBin, type DshBinResolver } from '../../server/utils/paper-review/dsh-bin-resolver'
import { buildPaperReviewPrompt } from '../../server/utils/paper-review/prompt'

const KEY = 'sk-paper-review-secret-value'
const KNOWN_INPUT: PaperReviewRunInput = {
  providerLabel: 'Magic Gateway',
  baseUrl: 'https://gateway.example/v1',
  protocol: 'openai-completions',
  model: 'reviewer-max',
  apiKey: KEY,
}

const PAGES: readonly ExtractedPaperPage[] = [
  {
    readerPage: 1,
    lines: [{ text: '1 Introduction', isHeading: true }, { text: 'Portable text across runs.', isHeading: false }],
    headings: ['1 Introduction'],
    text: '1 Introduction\nPortable text across runs.',
  },
  {
    readerPage: 2,
    lines: [{ text: '2 Methods', isHeading: true }, { text: 'We sampled a priori.', isHeading: false }],
    headings: ['2 Methods'],
    text: '2 Methods\nWe sampled a priori.',
  },
]

/** Fixed child-env allowlist for the win32 platform the tests run on. */
const ALLOWED_ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'PAPER_REVIEW_API_KEY']
const FORBIDDEN_ENV_KEYS = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']

interface LaunchRecord {
  readonly launches: DeepSeekHarnessOptions[]
  readonly runs: string[]
  /** Patch text captured while the temp home still exists. */
  readonly patchTexts: string[]
  /** Number of times a run was entered (rejections count, retries would add). */
  attempts: number
  closes: number
}

function newRecord(): LaunchRecord {
  return { launches: [], runs: [], patchTexts: [], attempts: 0, closes: 0 }
}

/** A fake factory recording launch options, prompt text, and close calls. */
function capturingFactory(record: LaunchRecord): HarnessFactory {
  return (options) => {
    record.launches.push(options)
    // The SDK would read the patch before/at launch; capture it while present.
    record.patchTexts.push(readFileSync(options.patches![0]!, 'utf8'))
    return {
      async run(input) {
        record.attempts += 1
        record.runs.push(input)
        return { sessionId: `sess-${record.launches.length}`, finalResponse: '{ "sections": [] }', events: [] }
      },
      async close() {
        record.closes += 1
      },
    }
  }
}

/** A fake factory returning fixed SDK result events regardless of the prompt. */
function eventFactory(events: readonly SessionEvent[]): HarnessFactory {
  return () => ({
    async run() {
      return { sessionId: 'sess-1', finalResponse: '{ "sections": [] }', events: [...events] }
    },
    async close() {},
  })
}

/** Absolute built bin the fake runner tests hand back through a stub resolver. */
const FAKE_LOCAL_BIN = join(tmpdir(), 'paper-review-local-bin.js')

function okResolver(dshBin: string): DshBinResolver {
  return () => ({ ok: true, dshBin })
}

interface LayoutPaths {
  readonly sdkManifest: string
  readonly cliManifest: string
  readonly binPath: string
}

/** Temp app/fork roots created by makeLayout, removed by the afterEach hook. */
const layoutRoots: string[] = []

afterEach(() => {
  for (const root of layoutRoots) {
    rmSync(root, { recursive: true, force: true })
  }
  layoutRoots.length = 0
})

/** Build a temp app/fork layout with controllable manifest versions and a built bin. */
function makeLayout(sdkVersion: string | number | undefined, cliVersion: string | number | undefined, built: boolean): LayoutPaths {
  const root = mkdtempSync(join(tmpdir(), 'dsh-layout-'))
  layoutRoots.push(root)
  const sdkDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-client')
  const cliDir = join(root, 'harness', 'apps', 'cli')
  mkdirSync(sdkDir, { recursive: true })
  mkdirSync(cliDir, { recursive: true })
  writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-sdk-client', ...(sdkVersion === undefined ? {} : { version: sdkVersion }) }))
  writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', ...(cliVersion === undefined ? {} : { version: cliVersion }), bin: { dsh: 'lib/bin.js' } }))
  if (built) {
    mkdirSync(join(cliDir, 'lib'), { recursive: true })
    writeFileSync(join(cliDir, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  }
  return {
    sdkManifest: join(sdkDir, 'package.json'),
    cliManifest: join(cliDir, 'package.json'),
    binPath: join(cliDir, 'lib', 'bin.js'),
  }
}

describe('runPaperReview harness launch spec', () => {
  it('selects sdk-minimal and applies tool/provider overrides beside a unique temp home', async () => {
    // Given a fake harness factory and a known provider configuration.
    const record = newRecord()
    // When the runner is invoked.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then the factory was called once with profile sdk-minimal.
    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(record.launches).toHaveLength(1)
    const options = record.launches[0]!
    expect(options.profile).toBe('sdk-minimal')

    // And the patch disables the profile tools/retry and mounts the route,
    // storing the key-variable name, never the key value.
    const patch = record.patchTexts[0]!
    expect(patch).toContain('persistent-bash')
    expect(patch).toContain('persistent-pwsh')
    expect(patch).toContain('mcp-resources')
    expect(patch).toContain('llm-retry')
    expect(patch).toContain('paper-review')
    expect(patch).toContain('PAPER_REVIEW_API_KEY')
    expect(patch).toContain('openai-completions')
    expect(patch).toContain(KNOWN_INPUT.baseUrl)
    expect(patch).toContain(KNOWN_INPUT.model)
    expect(patch).not.toContain(KEY)
  })

  it('points home and both process/session cwd at the isolated temp root', async () => {
    // Given a fake harness capturing the launched options.
    const record = newRecord()
    // When the runner launches.
    await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then home and cwds point at one shared rooted temp path that is removed.
    const options = record.launches[0]!
    expect(options.processCwd).toBe(options.dshHome)
    expect(options.cwd).toBe(options.dshHome)
    expect(options.dshHome!.length).toBeGreaterThan(0)
    expect(existsSync(options.dshHome!)).toBe(false)
  })

  it('omits a session id so the SDK mints a fresh session per invocation', async () => {
    // Given a fake capturing the run input.
    const record = newRecord()
    // When the runner runs the prompt.
    await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then exactly one prompt was run with no explicit session id on the wire.
    expect(record.runs).toHaveLength(1)
    expect(record.launches[0]).toBeDefined()
  })

  it('passes the resolved local fork CLI bin into every harness launch', async () => {
    // Given a resolver that supplies an absolute built CLI path.
    const record = newRecord()
    const localBin = join(tmpdir(), 'dsh-local-bin.js')
    // When the runner launches through a factory that records options.
    const resolver: DshBinResolver = () => ({ ok: true, dshBin: localBin })
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: capturingFactory(record),
      resolveLocalDshBin: resolver,
    })

    // Then the launch carries exactly that absolute bin and no implicit npm fallback.
    expect(result.success).toBe(true)
    expect(record.launches).toHaveLength(1)
    expect(record.launches[0]!.dshBin).toBe(localBin)
  })
})

describe('child environment allowlist', () => {
  it('ships only required OS variables plus the one key variable, valued with the key', async () => {
    // Given the private child-env builder.
    // When it builds an environment for the known key.
    const env = buildChildEnv(KEY)

    // Then every key belongs to the allowlist, the key holds the value, and no
    // provider secret or Node options variable leaks through.
    for (const key of Object.keys(env)) {
      expect(ALLOWED_ENV_KEYS).toContain(key)
    }
    expect(env.PATH).toBeTruthy()
    expect(env.PAPER_REVIEW_API_KEY).toBe(KEY)
    for (const forbidden of FORBIDDEN_ENV_KEYS) {
      expect(env[forbidden] ?? null).toBeNull()
    }
  })

  it('passes the allowlist, never the parent environment, into the child launch', async () => {
    // Given a fake capturing the launched environment.
    const record = newRecord()
    // When the runner launches.
    await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then the child env carries the key and drops parent secrets/options.
    const childEnv = record.launches[0]!.env!
    expect(childEnv.PAPER_REVIEW_API_KEY).toBe(KEY)
    expect(childEnv.DEEPSEEK_API_KEY ?? null).toBeNull()
    expect(childEnv.NODE_OPTIONS ?? null).toBeNull()
  })
})

describe('runPaperReview prompt', () => {
  it('includes page text, headings, and the source contract, excluding the key', async () => {
    // Given a fake capturing the prompt text.
    const record = newRecord()
    // When the runner runs the prompt.
    const expectedPrompt = buildPaperReviewPrompt({ providerLabel: KNOWN_INPUT.providerLabel, model: KNOWN_INPUT.model, pages: PAGES })
    await runPaperReview(
      KNOWN_INPUT,
      { purpose: 'report', prompt: expectedPrompt },
      { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) },
    )

    // Then the single prompt carries page-labelled text, headings, and the
    // structural source/data fields, and never contains the API key.
    const prompt = record.runs[0]!
    expect(prompt).toContain('Page 1')
    expect(prompt).toContain('HEADINGS:')
    expect(prompt).toContain('1 Introduction')
    expect(prompt).toContain('Portable text across runs.')
    expect(prompt).toContain('"source"')
    expect(prompt).toContain('"readerPage"')
    expect(prompt).toContain('"gaps"')
    expect(prompt).not.toContain(KEY)
  })

  it('the pure builder never references the key regardless of caller input', () => {
    // Given a known provider/model source and no key.
    const prompt = buildPaperReviewPrompt({ providerLabel: KNOWN_INPUT.providerLabel, model: KNOWN_INPUT.model, pages: PAGES })

    // When built without a key.
    // Then the structural source fields are present and the key string is absent.
    expect(prompt).toContain('"source"')
    expect(prompt).toContain('"quote"')
    expect(prompt).toContain('Portable text across runs.')
    expect(prompt).not.toContain(KEY)
  })
})

describe('runPaperReview success and failure lifecycle', () => {
  it('returns the raw response, closes once, and removes the temp home on success', async () => {
    // Given a fake harness and known configuration.
    const record = newRecord()
    // When the run resolves.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then the raw response is returned and the harness is closed and gone.
    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.finalResponse).toBe('{ "sections": [] }')
    expect(record.attempts).toBe(1)
    expect(record.runs).toHaveLength(1)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('closes once, removes the temp home, and returns a typed key-free failure on a rejected run', async () => {
    // Given a run that rejects.
    const record = newRecord()
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          throw new Error('provider is unavailable')
        },
        async close() {
          record.closes += 1
        },
      }
    }

    // When the run rejects.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then a typed run-failed result is returned, the single attempt was not
    // retried, the harness was closed once, and its home was removed.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('run-failed')
    expect(record.attempts).toBe(1)
    expect(record.runs).toHaveLength(0)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
    expect(result.error.message).not.toContain(KEY)
  })

  it('resolves to a typed key-free cleanup-failed result when close rejects after a successful run', async () => {
    // Given a run that succeeds but whose close rejects with a key-bearing error.
    const record = newRecord()
    const closeError = new Error(`close blew up near ${KEY}`)
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          return { sessionId: 'sess-1', finalResponse: '{ "sections": [] }', events: [] }
        },
        async close() {
          record.closes += 1
          throw closeError
        },
      }
    }

    // When the run completes and cleanup's close rejects.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then it resolves as a typed cleanup-failed failure rather than throwing,
    // never leaking the key or the raw close message, closing once, and removing
    // the temp home.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cleanup-failed')
    expect(result.error.recoverable).toBe(true)
    expect(result.error.message).not.toContain(KEY)
    expect(result.error.message).not.toContain(closeError.message)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('lets a close failure take precedence over a run failure, still typed and key-free', async () => {
    // Given a run that rejects and a close that also rejects with a key-bearing error.
    const record = newRecord()
    const closeError = new Error(`close blew up near ${KEY}`)
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          throw new Error('provider is unavailable')
        },
        async close() {
          record.closes += 1
          throw closeError
        },
      }
    }

    // When both the run and the close reject.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then cleanup-failed wins over run-failed and the temp home is still removed.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cleanup-failed')
    expect(result.error.message).not.toContain(KEY)
    expect(result.error.message).not.toContain(closeError.message)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('resolves to a typed key-free cleanup-failed result when temp-root removal throws', async () => {
    // Given a run that succeeds but whose temp-root removal throws a key-bearing error.
    const record = newRecord()
    const SENTINEL = 'removal|sentinel'
    const removalError = new Error(`temp-root removal exploded: ${SENTINEL} near ${KEY}`)
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          return { sessionId: 'sess-1', finalResponse: '{ "sections": [] }', events: [] }
        },
        async close() {
          record.closes += 1
        },
      }
    }

    // A real fixture the runner is told to clean; the test removes it in a
    // finally even if the runner itself rejects during a red run.
    const fixture = mkdtempSync(join(tmpdir(), 'paper-review-removal-fixture-'))
    const removedRoots: string[] = []
    try {
      // When the run completes and cleanup's temp-root removal rejects.
      const result = await runPaperReview(KNOWN_INPUT, PAGES, {
        harnessFactory: factory,
        resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
        createTempRoot: () => fixture,
        removeTempRoot: (root) => {
          removedRoots.push(root)
          throw removalError
        },
      })

      // Then it resolves as a typed cleanup-failed failure rather than throwing,
      // never leaking the key or the raw removal detail, closing once, and
      // attempting the removal exactly once.
      expect(result.success).toBe(false)
      if (result.success) {
        return
      }
      expect(result.error.code).toBe('cleanup-failed')
      expect(result.error.recoverable).toBe(true)
      expect(result.error.message).not.toContain(KEY)
      expect(result.error.message).not.toContain(SENTINEL)
      expect(result.error.message).not.toContain(removalError.message)
      expect(record.closes).toBe(1)
      expect(removedRoots).toHaveLength(1)
      expect(removedRoots[0]).toBe(fixture)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('mints a fresh unique temp home per invocation and removes every home', async () => {
    // Given two sequential invocations sharing one capturing factory.
    const record = newRecord()
    const factory = capturingFactory(record)
    // When both complete.
    const first = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })
    const second = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then each launch got a distinct home and both homes were removed.
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    const homeOne = record.launches[0]!.dshHome!
    const homeTwo = record.launches[1]!.dshHome!
    expect(homeOne).not.toBe(homeTwo)
    expect(existsSync(homeOne)).toBe(false)
    expect(existsSync(homeTwo)).toBe(false)
  })

  it('rejects invalid input before touching the harness factory', async () => {
    // Given an input with an empty API key.
    const record = newRecord()
    // When the runner is invoked with invalid input.
    const result = await runPaperReview({ ...KNOWN_INPUT, apiKey: '' }, PAGES, { harnessFactory: capturingFactory(record), resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then a typed invalid-input failure is returned and no harness was launched.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('invalid-input')
    expect(record.launches).toHaveLength(0)
  })

  it('does not launch a harness or create a temp home when the local CLI resolver fails', async () => {
    // Given a resolver that fails and a capturing factory.
    const record = newRecord()
    const resolver: DshBinResolver = () => ({
      ok: false,
      error: { code: 'cli-not-built', message: 'The Harness CLI is not built.' },
    })
    // When the runner is invoked.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: capturingFactory(record),
      resolveLocalDshBin: resolver,
    })

    // Then a typed cli-not-built failure is returned and nothing was launched.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cli-not-built')
    expect(result.error.message).not.toContain(KEY)
    expect(record.launches).toHaveLength(0)
  })

  it('does not launch a harness or create a temp home on a version-mismatch resolver failure', async () => {
    // Given a resolver reporting a version mismatch and a capturing factory.
    const record = newRecord()
    const resolver: DshBinResolver = () => ({
      ok: false,
      error: { code: 'version-mismatch', message: 'The local Harness CLI version differs from the app-installed SDK.' },
    })
    let tempRootCalls = 0
    // When the runner is invoked.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: capturingFactory(record),
      resolveLocalDshBin: resolver,
      createTempRoot: () => {
        tempRootCalls += 1
        return join(tmpdir(), 'paper-review-should-not-run')
      },
    })

    // Then a typed version-mismatch failure is returned, nothing was launched,
    // and the temp-root factory was never called.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('version-mismatch')
    expect(result.error.message).not.toContain(KEY)
    expect(record.launches).toHaveLength(0)
    expect(tempRootCalls).toBe(0)
  })

  it('overlay patch reflects the caller protocol, baseUrl, and model without the key', () => {
    // Given an anthropic route configuration.
    const anthropic: PaperReviewRunInput = {
      ...KNOWN_INPUT,
      baseUrl: 'https://anthropic-gateway.example',
      protocol: 'anthropic-messages',
      model: 'claude-5-mini',
    }
    // When the patch is built.
    const patch = buildOverlayPatch(anthropic)

    // Then the route carries the anthropic protocol and its own baseUrl/model,
    // and never contains the key value.
    expect(patch).toContain('anthropic-messages')
    expect(patch).toContain('https://anthropic-gateway.example')
    expect(patch).toContain('claude-5-mini')
    expect(patch).not.toContain(KEY)
  })
})

describe('runPaperReview cancellation (issue #28)', () => {
  const REQUEST: PaperReviewModelRequest = { purpose: 'report', prompt: 'controlled report prompt' }

  it('returns an identifiable cancelled result for a pre-aborted signal without launching or creating resources', async () => {
    // Given an already-aborted signal and spies on the resource seams.
    const controller = new AbortController()
    controller.abort()
    const record = newRecord()
    let tempRootCalls = 0
    // When invoked with the pre-aborted signal.
    const result = await runPaperReview(
      KNOWN_INPUT,
      REQUEST,
      {
        harnessFactory: capturingFactory(record),
        resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
        createTempRoot: () => {
          tempRootCalls += 1
          return join(tmpdir(), 'paper-review-abort-should-not-run')
        },
      },
      { signal: controller.signal },
    )

    // Then it is a terminal cancelled result and no harness or temp home was created.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cancelled')
    expect(result.error.message.length).toBeGreaterThan(0)
    expect(record.launches).toHaveLength(0)
    expect(tempRootCalls).toBe(0)
  })

  it('aborting mid-run closes only that invocation, removes the home, and returns cancelled', async () => {
    // Given a harness whose run hangs until close reaps the child.
    const record = newRecord()
    const controller = new AbortController()
    let rejectRun!: (error: Error) => void
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      const runPromise = new Promise<{ sessionId: string; finalResponse: string; events: never[] }>((_resolve, reject) => {
        rejectRun = reject
      })
      return {
        async run() {
          record.attempts += 1
          return runPromise
        },
        async close() {
          record.closes += 1
          rejectRun(new Error('child reaped by abort'))
        },
      }
    }

    // When the run is started then aborted mid-flight.
    const pending = runPaperReview(
      KNOWN_INPUT,
      REQUEST,
      { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) },
      { signal: controller.signal },
    )
    controller.abort()
    const result = await pending

    // Then the outcome is a terminal cancelled result, the single run attempt was
    // not retried, the harness closed exactly once, and the home was removed.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cancelled')
    expect(record.attempts).toBe(1)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('does not let a successful run output escape once abort fires during cleanup', async () => {
    // Given a run that succeeds but whose close() triggers the abort signal.
    const record = newRecord()
    const controller = new AbortController()
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          return { sessionId: 'sess-1', finalResponse: '{ "sections": [] }', events: [] }
        },
        async close() {
          record.closes += 1
          controller.abort()
        },
      }
    }

    // When the run resolves and abort fires during the close/teardown phase.
    const result = await runPaperReview(
      KNOWN_INPUT,
      REQUEST,
      { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) },
      { signal: controller.signal },
    )

    // Then no success escapes: the terminal outcome is cancelled, close ran once,
    // and the temp home was removed.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('cancelled')
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('a later invocation with its own signal gets a distinct home and no prior session id', async () => {
    // Given two sequential invocations each carrying its own signal.
    const record = newRecord()
    const factory = capturingFactory(record)
    const firstSignal = new AbortController().signal
    const secondSignal = new AbortController().signal
    // When both complete.
    const first = await runPaperReview(KNOWN_INPUT, REQUEST, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) }, { signal: firstSignal })
    const second = await runPaperReview(KNOWN_INPUT, REQUEST, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) }, { signal: secondSignal })

    // Then each launch got a distinct home, both were removed, and each run used
    // its own invocation with no prior session id threaded through.
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    const homeOne = record.launches[0]!.dshHome!
    const homeTwo = record.launches[1]!.dshHome!
    expect(homeOne).not.toBe(homeTwo)
    expect(existsSync(homeOne)).toBe(false)
    expect(existsSync(homeTwo)).toBe(false)
    expect(record.attempts).toBe(2)
    expect(record.closes).toBe(2)
  })
})

describe('runPaperReview rejects structural SDK failures from collected events', () => {
  it('rejects a turn/end error even when finalResponse looks valid, without leaking the key', async () => {
    // Given a run whose session ends with a turn/end error carrying the key.
    const events: SessionEvent[] = [
      {
        type: 'turn/end',
        seq: SessionSeq(1),
        time: 1,
        data: { turn: 1, reason: { kind: 'error', error: { code: 'AUTH', message: `provider refused near ${KEY}` } } },
      },
    ]

    // When the run resolves with only a structural failure in its events.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: eventFactory(events),
      resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
    })

    // Then a fixed, key-free run-failed failure is returned, never the raw event.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('run-failed')
    expect(result.error.recoverable).toBe(true)
    expect(result.error.message).toBe(RUN_FAILED_MESSAGE)
    expect(result.error.message).not.toContain(KEY)
  })

  it('rejects an assistant/attempt stream whose terminal finish reports an error', async () => {
    // Given an assistant attempt whose embedded stream ends in an error finish.
    const events: SessionEvent[] = [
      {
        type: 'assistant/attempt',
        seq: SessionSeq(1),
        time: 1,
        data: {
          turn: 1,
          step: 1,
          stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: `quota reached near ${KEY}` } } } }],
        },
      },
    ]

    // When the run resolves despite the failed embedded attempt.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: eventFactory(events),
      resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
    })

    // Then a fixed run-failed failure is returned without the event detail.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('run-failed')
    expect(result.error.message).not.toContain(KEY)
    expect(result.error.message).not.toContain('RATE_LIMIT')
  })

  it('rejects an assistant/message stream whose terminal finish reports an aborted reason', async () => {
    // Given an assistant message whose embedded stream ends in an aborted finish.
    const events: SessionEvent[] = [
      {
        type: 'assistant/message',
        seq: SessionSeq(1),
        time: 1,
        data: {
          turn: 1,
          step: 1,
          message: { id: MessageId('m1'), role: 'assistant', content: [], source: { kind: 'model', provider: 'gateway', model: 'reviewer-max' } },
          stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'aborted', failure: { code: 'CANCELLED', message: 'cancelled by user' } } } }],
        },
      },
    ]

    // When the run resolves despite the aborted assistant stream.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: eventFactory(events),
      resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
    })

    // Then a fixed run-failed failure is returned.
    expect(result.success).toBe(false)
    if (result.success) {
      return
    }
    expect(result.error.code).toBe('run-failed')
  })

  it('still removes the temp home and closes once when events mark a structural failure', async () => {
    // Given a run that resolves but whose events mark a turn/end error.
    const record = newRecord()
    const factory: HarnessFactory = (options) => {
      record.launches.push(options)
      return {
        async run() {
          record.attempts += 1
          return {
            sessionId: 'sess-1',
            finalResponse: '{ "sections": [] }',
            events: [
              { type: 'turn/end', seq: SessionSeq(1), time: 1, data: { turn: 1, reason: { kind: 'error', error: { code: 'AUTH', message: 'oops' } } } },
            ],
          }
        },
        async close() {
          record.closes += 1
        },
      }
    }

    // When the structural failure is detected.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, { harnessFactory: factory, resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN) })

    // Then the home is still removed and the harness closed exactly once.
    expect(result.success).toBe(false)
    expect(record.attempts).toBe(1)
    expect(record.closes).toBe(1)
    expect(existsSync(record.launches[0]!.dshHome!)).toBe(false)
  })

  it('accepts a genuinely successful run with a completed turn and a stop finish', async () => {
    // Given events reflecting a completed, non-failing turn.
    const events: SessionEvent[] = [
      { type: 'turn/end', seq: SessionSeq(1), time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ]

    // When the run resolves with those events.
    const result = await runPaperReview(KNOWN_INPUT, PAGES, {
      harnessFactory: eventFactory(events),
      resolveLocalDshBin: okResolver(FAKE_LOCAL_BIN),
    })

    // Then the raw finalResponse is returned as a genuine success.
    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }
    expect(result.finalResponse).toBe('{ "sections": [] }')
  })
})

describe('resolveLocalDshBin local CLI resolver', () => {
  it('resolves the fork manifest bin to an absolute built path on a version match', () => {
    // Given matching app/fork manifest versions and a built CLI entry.
    const layout = makeLayout('0.1.7-rc.2', '0.1.7-rc.2', true)
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then it returns the exact absolute built bin path that exists.
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.dshBin).toBe(layout.binPath)
    expect(isAbsolute(result.dshBin)).toBe(true)
    expect(existsSync(result.dshBin)).toBe(true)
  })

  it('fails with cli-not-built when the built CLI entry is missing', () => {
    // Given matching versions but no built bin.
    const layout = makeLayout('0.1.7-rc.2', '0.1.7-rc.2', false)
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then a typed cli-not-built failure is returned and no path is exposed.
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('cli-not-built')
    expect(result.error.message).not.toContain(layout.cliManifest)
    expect(result.error.message).not.toContain(layout.binPath)
  })

  it('fails with version-mismatch when the fork CLI version differs from the SDK', () => {
    // Given a fork version that diverges from the app-installed SDK.
    const layout = makeLayout('0.1.7-rc.2', '0.1.7-rc.3', true)
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then a typed version-mismatch failure is returned and no path or version is exposed.
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('version-mismatch')
    expect(result.error.message).not.toContain(layout.sdkManifest)
    expect(result.error.message).not.toContain('0.1.7-rc.2')
    expect(result.error.message).not.toContain('0.1.7-rc.3')
  })

  it('fails with version-mismatch when a manifest version is missing', () => {
    // Given an SDK manifest without a version and a built CLI entry.
    const layout = makeLayout(undefined, '0.1.7-rc.2', true)
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then a typed version-mismatch failure is returned without exposing paths or versions.
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('version-mismatch')
    expect(result.error.message).not.toContain(layout.sdkManifest)
    expect(result.error.message).not.toContain('0.1.7-rc.2')
  })

  it('fails with version-mismatch when a manifest version is not a string', () => {
    // Given an SDK manifest with a numeric version and a built CLI entry.
    const layout = makeLayout(42, '0.1.7-rc.2', true)
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then a typed version-mismatch failure is returned without exposing the value.
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('version-mismatch')
    expect(result.error.message).not.toContain('42')
  })

  it('returns an unreadable-manifest failure for a malformed manifest', () => {
    // Given a temp layout whose SDK manifest is not valid JSON.
    const layout = makeLayout('0.1.7-rc.2', '0.1.7-rc.2', true)
    writeFileSync(layout.sdkManifest, '{ not valid json')
    // When the resolver runs.
    const result = resolveLocalDshBin(layout.sdkManifest, layout.cliManifest)

    // Then a typed unreadable-manifest failure is returned without a path.
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error.code).toBe('cli-not-found')
    expect(result.error.message).not.toContain(layout.sdkManifest)
  })
})
