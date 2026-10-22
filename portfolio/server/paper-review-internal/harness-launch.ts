/**
 * Private launch configuration for the paper-review Harness runner (issue #27).
 *
 * Lives outside `server/utils` so Nuxt auto-import does not scan it. Owns the
 * fixed provider route / key-environment names and the per-run overlay patch
 * and strict child-environment allowlist. The API key value never appears in
 * the patch, the prompt, or any returned error.
 */

import type { PaperReviewRunInput } from '../utils/paper-review/harness'

/** Fixed provider route this runner selects on the inserted pi-ai adapter. */
export const PAPER_REVIEW_ROUTE = 'paper-review'
/** Environment variable that carries the caller's key to the child process. */
const PAPER_REVIEW_KEY_ENV = 'PAPER_REVIEW_API_KEY'

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
