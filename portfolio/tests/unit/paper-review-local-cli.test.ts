import { describe, expect, it, vi } from 'vitest'
import { main, renderFailure, renderLoadFailure, renderRun } from '../../scripts/paper-review-local/cli'
import type { PaperReviewLocalConfig } from '../../scripts/paper-review-local/config'
import type { PaperReviewLocalRunResult, PaperReviewLocalRunSummary } from '../../scripts/paper-review-local/runner'

const FIXTURE_CONFIG: PaperReviewLocalConfig = {
  modelId: 'deepseek-r1',
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.example.com/v1',
  protocol: 'openai-completions',
  providerLabel: 'api.example.com',
  pdfPath: 'C:/work/papers/demo.pdf',
}

function captureWrite(): { lines: string[]; write: (lines: readonly string[]) => void } {
  const lines: string[] = []
  return { lines, write: (out) => lines.push(...out) }
}

function okSummary(overrides: Partial<PaperReviewLocalRunSummary> = {}): Extract<PaperReviewLocalRunResult, { ok: true }> {
  return {
    ok: true,
    summary: {
      ok: true,
      stages: ['validating', 'extracting', 'inventorying', 'analyzing', 'translating', 'verifying'],
      status: 'incomplete',
      units: 3,
      pairs: 6,
      reportSections: 3,
      findings: 5,
      gaps: 2,
      reviewStatus: 'passed',
      ...overrides,
    },
  }
}

describe('paper-review-local CLI gating and output', () => {
  it('does not read any config and fails closed when --allow-paid is absent', async () => {
    // Given: a config-loading spy that records whether it is ever called.
    const loadConfig = vi.fn()
    const { lines, write } = captureWrite()

    // When: the CLI runs with no arguments.
    const code = await main([], { loadConfig, runReview: vi.fn(), write })

    // Then: it exits nonzero, never touches the config, and prints the gate message.
    expect(code).not.toBe(0)
    expect(loadConfig).not.toHaveBeenCalled()
    expect(lines).toEqual(renderFailure('require-allow-paid'))
  })

  it('rejects unknown arguments before touching config', async () => {
    // Given: a config spy and a bogus argument.
    const loadConfig = vi.fn()
    const { lines, write } = captureWrite()

    // When: the CLI runs with an unknown flag.
    const code = await main(['--bogus'], { loadConfig, runReview: vi.fn(), write })

    // Then: it exits nonzero, the config is never read, and the unknown-arg message prints.
    expect(code).not.toBe(0)
    expect(loadConfig).not.toHaveBeenCalled()
    expect(lines).toEqual(renderFailure('unknown-arg'))
  })

  it('loads config and prints stages and counts on a successful run', async () => {
    // Given: an injected fake config loader and a fake (non-paid) runner.
    const loadConfig = vi.fn(() => ({ ok: true as const, config: FIXTURE_CONFIG }))
    const runReview = vi.fn(async () => okSummary())
    const { lines, write } = captureWrite()

    // When: the CLI runs with --allow-paid.
    const code = await main(['--allow-paid'], { loadConfig, runReview, write })

    // Then: it exits 0, drives the injected runner with the config, and prints safe counts.
    expect(code).toBe(0)
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(runReview).toHaveBeenCalledWith(FIXTURE_CONFIG)
    expect(lines).toEqual(renderRun(okSummary().summary))
    expect(lines.join('\n')).toContain('stages: validating extracting inventorying analyzing translating verifying')
    expect(lines.join('\n')).toContain('status: incomplete')
    expect(lines.join('\n')).toContain('units: 3')
    expect(lines.join('\n')).toContain('pairs: 6')
    expect(lines.join('\n')).toContain('reportSections: 3')
    expect(lines.join('\n')).toContain('findings: 5')
    expect(lines.join('\n')).toContain('gaps: 2')
    expect(lines.join('\n')).toContain('reviewStatus: passed')
  })

  it('prints a fixed sanitized message when the runner throws, leaking no details', async () => {
    // Given: a fake runner that throws text carrying a secret, a path, and an endpoint.
    const loadConfig = vi.fn(() => ({ ok: true as const, config: FIXTURE_CONFIG }))
    const runReview = vi.fn(async () => {
      throw new Error('LEAK sk-abc-secret at /etc/private.txt via https://api.example.com/explode')
    })
    const { lines, write } = captureWrite()

    // When: the CLI runs.
    const code = await main(['--allow-paid'], { loadConfig, runReview, write })

    // Then: it exits nonzero and only the fixed sanitized message is printed.
    expect(code).not.toBe(0)
    expect(lines).toEqual(renderFailure('run-failed'))
    const output = lines.join('\n')
    expect(output).not.toContain('LEAK')
    expect(output).not.toContain('sk-abc')
    expect(output).not.toContain('/etc/private.txt')
    expect(output).not.toContain('api.example.com')
  })

  it('catches a throwing config loader and prints a fixed sanitized message with no leak', async () => {
    // Given: a config loader that throws text carrying an API key and a path.
    const loadConfig = vi.fn(() => {
      throw new Error('LEAK sk-abc-secret at /secret/.env.test.local')
    })
    const { lines, write } = captureWrite()

    // When: the CLI runs with --allow-paid.
    const code = await main(['--allow-paid'], { loadConfig, runReview: vi.fn(), write })

    // Then: it exits 1 with a fixed sanitized message, leaking no key, path, or raw error.
    expect(code).toBe(1)
    const output = lines.join('\n')
    expect(output).toContain('paper-review:local')
    expect(output).not.toContain('LEAK')
    expect(output).not.toContain('sk-abc')
    expect(output).not.toContain('/secret/')
    expect(output).not.toContain('Error')
  })

  it('maps a config validation failure to a sanitized message with no value echo', async () => {
    // Given: a config loader that reports an invalid base URL.
    const loadConfig = vi.fn(() => ({ ok: false as const, code: 'invalid-base-url' as const }))
    const { lines, write } = captureWrite()

    // When: the CLI runs.
    const code = await main(['--allow-paid'], { loadConfig, runReview: vi.fn(), write })

    // Then: it exits nonzero and prints only the fixed sanitized message.
    expect(code).not.toBe(0)
    expect(lines).toEqual(renderLoadFailure('invalid-base-url'))
    expect(lines.join('\n')).not.toContain('baseUrl')
  })

  it('prints the error code and exits nonzero when the run reports a failure', async () => {
    // Given: a fake runner reporting a PDF read failure.
    const loadConfig = vi.fn(() => ({ ok: true as const, config: FIXTURE_CONFIG }))
    const runReview = vi.fn(async () => ({ ok: false as const, code: 'pdf-unreadable' as const }))
    const { lines, write } = captureWrite()

    // When: the CLI runs.
    const code = await main(['--allow-paid'], { loadConfig, runReview, write })

    // Then: it exits nonzero with the sanitized run-failure message.
    expect(code).not.toBe(0)
    expect(lines).toEqual(renderFailure('pdf-unreadable'))
  })
})