import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperTaskBranch, PaperTaskSelection } from '../../app/utils/paper-task-contract'

export function writeTaskInput(root: string, taskId: string, selection: PaperTaskSelection): string {
  const path = join(root, 'task-input.md')
  const branches: readonly PaperTaskBranch[] = selection === 'both'
    ? ['translation', 'deep-reading']
    : [selection]
  const instructions = [
    `Task ${taskId} is an ongoing paper-generation task.`,
    `Selected branches: ${branches.join(', ')}.`,
    'Read this file and the source records with the provided task tools. Load the pinned branch skill and its references by reading their resource identifiers when needed; do not replace those resources with a summary.',
    'Instruction precedence: this task file and approved paper-quality specification take priority over general skill instructions. Use only the minimum source records needed; preserve source crops for tables, never rebuild or translate table contents, and keep references in English.',
    'The task-specific extraction, record, and preview limits in this input override conflicting skill instructions. Do not execute skill scripts, shell commands, or unrelated tools.',
    'Use original source records as evidence. The task tools expose no shared-source writes and no other task paths.',
    'Produce only a natural Markdown text preview for the selected branch. This is an unfinished preview, not a complete translation, report, or quality approval. Make no claim of accuracy or completeness.',
  ].join('\n\n')
  writeFileSync(path, instructions, { flag: 'wx', mode: 0o444 })
  return path
}
