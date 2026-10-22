import { resolve } from 'node:path'

export const DEFAULT_TIMEOUT_MS = 3_600_000
export const MAX_TIMEOUT_MS = 3_600_000

export function parseArgs(args, cwd) {
  let allowPaid = false
  let selection = 'both'
  let environment = 'test'
  let pdfPath = resolve(cwd, 'tests/fixtures/paper-task-source-fixture.pdf')
  let timeoutMs = DEFAULT_TIMEOUT_MS

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--allow-paid') allowPaid = true
    else if (arg.startsWith('--selection=')) selection = arg.slice('--selection='.length)
    else if (arg.startsWith('--env=')) environment = arg.slice('--env='.length)
    else if (arg.startsWith('--pdf=')) pdfPath = resolve(cwd, arg.slice('--pdf='.length))
    else if (arg.startsWith('--timeout-ms=')) {
      const value = Number(arg.slice('--timeout-ms='.length))
      if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) return { error: 'timeout' }
      timeoutMs = value
    } else return { error: 'arguments' }
  }
  if (!['translation', 'deep-reading', 'both'].includes(selection)) return { error: 'selection' }
  if (!['test', 'development'].includes(environment)) return { error: 'environment' }
  return { allowPaid, selection, environment, pdfPath, timeoutMs }
}

export function acceptsRetainedResult({ terminal, selection, generatedBranches, reviews, reader, originalPdf, inputPdf }) {
  if (terminal.outcome !== 'succeeded' || terminal.cleanup !== 'clean' || reader === undefined || originalPdf === undefined) return false
  if (!Buffer.from(originalPdf).equals(Buffer.from(inputPdf))) return false
  const selectedBranches = selection === 'both' ? ['translation', 'deep-reading'] : [selection]
  const validStates = new Set(['preview-ready', 'needs-confirmation', 'complete'])
  if (!selectedBranches.every((branch) => validStates.has(terminal.branches[branch]))) return false
  if (!['translation', 'deep-reading'].filter((branch) => !selectedBranches.includes(branch)).every((branch) => terminal.branches[branch] === 'not-selected')) return false
  if (!selectedBranches.every((branch) => generatedBranches.has(branch))) return false
  if (!selectedBranches.every((branch) => reviews[branch]?.reviewCompleted === true)) return false
  if (reader.taskId !== terminal.taskId || !reader.pdfs.original.available) return false
  return selectedBranches.every((branch) => {
    const document = reader.documents.find((candidate) => candidate.branch === branch)
    return document !== undefined
      && document.markdown.trim().length > 0
      && ['preview', 'needs-confirmation', 'complete'].includes(document.status)
      && (terminal.branches[branch] !== 'complete' || document.status === 'complete')
  })
}
