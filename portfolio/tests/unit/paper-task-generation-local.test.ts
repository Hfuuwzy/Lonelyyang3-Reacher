import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { acceptsRetainedResult, DEFAULT_TIMEOUT_MS, parseArgs } from '../../scripts/paper-task-generation-local/acceptance.mjs'

const taskId = '123e4567-e89b-12d3-a456-426614174000'
const bytes = new Uint8Array([37, 80, 68, 70])

function validResult(
  status: 'preview-ready' | 'needs-confirmation' | 'complete' = 'needs-confirmation',
  documentStatus: 'preview' | 'needs-confirmation' | 'complete' = status === 'preview-ready' ? 'preview' : status,
) {
  const reviews: Record<string, { reviewCompleted: boolean }> = { 'deep-reading': { reviewCompleted: true } }
  return {
    terminal: {
      taskId,
      outcome: 'succeeded',
      cleanup: 'clean',
      branches: { translation: 'not-selected', 'deep-reading': status },
    },
    selection: 'deep-reading',
    generatedBranches: new Set(['deep-reading']),
    reviews,
    reader: {
      taskId,
      documents: [{ branch: 'deep-reading', status: documentStatus, markdown: '# report' }],
      pdfs: { original: { available: true } },
    },
    originalPdf: bytes,
    inputPdf: bytes,
  }
}

describe('paper-task-generation-local acceptance', () => {
  it.each(['preview-ready', 'needs-confirmation', 'complete'] as const)(
    'accepts readable %s only when retained review evidence is current', (status) => {
      // Given: a successful task with coherent retained PDF and reader artifact.
      const result = validResult(status)

      // When: the retained-result predicate evaluates the task.
      const accepted = acceptsRetainedResult(result)

      // Then: review-backed retained content is accepted for each readable branch state.
      expect(accepted).toBe(true)
    },
  )

  it('rejects a status-only result without current review evidence', () => {
    // Given: a terminal says preview-ready, but the retained reader has no completed review state.
    const result = validResult('preview-ready', 'preview')
    result.reviews['deep-reading'].reviewCompleted = false

    // When: retained-result acceptance is evaluated.
    const accepted = acceptsRetainedResult(result)

    // Then: the result is rejected.
    expect(accepted).toBe(false)
  })

  it('rejects retained PDF bytes that differ from the submitted source', () => {
    // Given: a successful task whose retained original differs from the submitted bytes.
    const result = validResult()
    result.originalPdf = new Uint8Array([37, 80, 68, 70, 1])

    // When: retained-result acceptance is evaluated.
    const accepted = acceptsRetainedResult(result)

    // Then: the result is rejected.
    expect(accepted).toBe(false)
  })

  it('rejects a readable document without a completed current review', () => {
    // Given: readable retained content whose quality evidence reports no completed review.
    const result = validResult()
    result.reviews['deep-reading'].reviewCompleted = false

    // When: retained-result acceptance is evaluated.
    const accepted = acceptsRetainedResult(result)

    // Then: the result is rejected.
    expect(accepted).toBe(false)
  })

  it('parses PDF paths containing spaces and bounded deadlines', () => {
    // Given: CLI arguments relative to a working directory.
    const parsed = parseArgs(['--pdf=paper files/original.pdf', '--timeout-ms=12000'], 'C:/workspace')

    // When: arguments are parsed.
    // Then: path resolution preserves spaces and defaults remain stable.
    expect(parsed.pdfPath).toBe('C:\\workspace\\paper files\\original.pdf')
    expect(parsed.timeoutMs).toBe(12000)
    expect(parseArgs([], 'C:/workspace').timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(parseArgs([], 'C:/workspace').selection).toBe('both')
    expect(parseArgs(['--timeout-ms=0'], 'C:/workspace')).toEqual({ error: 'timeout' })
    expect(parseArgs(['--timeout-ms=3600001'], 'C:/workspace')).toEqual({ error: 'timeout' })
  })

  it('does not read provider configuration without the paid-call guard', () => {
    // Given: an isolated working directory with no provider configuration.
    // When: the CLI runs without --allow-paid.
    const result = spawnSync(process.execPath, ['scripts/paper-task-generation-local.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    // Then: it stops at the guard with a sanitized no-config-read message.
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no config was read')
    expect(result.stderr).not.toContain('LLM_API_KEY=')
  })
})
