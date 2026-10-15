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
    'Instruction precedence: this task file and approved paper-quality specification take priority over general skill instructions. Translation may use its existing minimum-record workflow. Deep reading must first discover the complete source index and read every indexed original record fully, including records after the first 200; do not treat source summaries as substitutes.',
    'The task-specific extraction, record, and preview limits in this input override conflicting skill instructions. Do not execute skill scripts, shell commands, or unrelated tools.',
    'Use original source records as evidence. The task tools expose no shared-source writes and no other task paths.',
    'Preserve source crops for tables, never rebuild or translate table contents, and keep references in English. Translation remains an unfinished natural Markdown text preview, not a quality-approved complete translation.',
    ...(branches.includes('deep-reading') ? [
      'For deep reading, independently analyze the original paper whether or not translation is selected or complete. Select an analysis framework suited to this paper from the pinned resources; synthesize the research problem, method, evidence, limitations, and applications into connected reasoning, not paragraph-by-paragraph translation or concatenated batch summaries. Use natural Markdown without a fixed five-section template or source-position markers. Distinguish reported facts from your inferences in reader-visible prose; connect important passages to the required internal claim/evidence entries. Do not guess from unverified crops, tables, formulas, or algorithms.',
      'Save a whole-paper Markdown main draft. If essential material or an asset is missing, ambiguous, unreadable, or unverified, include a reader-visible confirmation or uncompleted note and record the reason internally. Never claim quality approval or completion. Introduce each key factual passage as a paper-reported fact and each interpretation as an inference in the report language; associate those exact passages with claim_evidence. Labels such as 论文报告 / 分析推论 or Fact / Inference are supported without requiring fixed article headings.',
    ] : []),
    'Keep the existing preview.md and event behavior for compatibility. A saved preview is not itself a quality approval.',
  ].join('\n\n')
  writeFileSync(path, instructions, { flag: 'wx', mode: 0o444 })
  return path
}
