// Tiny bootstrap for the local paper-review CLI (issue #27). Loads the
// TypeScript CLI entry via the installed jiti and mirrors its exit code.
// A bootstrap or load failure prints one fixed sanitized message and exits
// nonzero; the raw exception is never surfaced.
import { createJiti } from 'jiti'

const BOOTSTRAP_FAILURE_MESSAGE = 'paper-review:local: the local CLI could not start.'

const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false })

try {
  const { main } = await jiti.import('./paper-review-local/cli.ts')
  process.exitCode = await main(process.argv.slice(2))
} catch {
  console.error(BOOTSTRAP_FAILURE_MESSAGE)
  process.exitCode = 1
}
