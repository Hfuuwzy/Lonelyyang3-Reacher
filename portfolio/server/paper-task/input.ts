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
    'Instruction precedence: this task file and approved paper-quality specification take priority over general skill instructions. Translation must cover the whole paper; deep reading must first discover the complete source index and read every indexed original record fully, including records after the first 200; do not treat source summaries as substitutes.',
    'The task-specific extraction, record, and preview limits in this input override conflicting skill instructions. Do not execute skill scripts, shell commands, or unrelated tools.',
    'Use original source records as evidence. The task tools expose no shared-source writes and no other task paths.',
    'Preserve source crops for tables, never rebuild or translate table contents, and keep references in English. Translation remains an unfinished natural Markdown text preview, not a quality-approved complete translation.',
    'Approved image crops may appear as inline image blocks immediately beside their original record context. Treat only the supplied original crop bytes as visual input; a path, attachment, blocked/unwired receipt, or visible crop is not proof that an image was understood. If an image is blocked or unavailable, report it as unverified and ask for confirmation where essential.',
    'Keep each crop attached to its supplied task, branch, source record, revision, page, and bounding-box context. Preserve original source numbering and context. Tables must remain the original clear crop; never translate, reconstruct, or generatively redraw them. Do not claim visual understanding, quality acceptance, or completion from image transport.',
    ...(branches.includes('translation') ? [
      'For translation, first discover the complete source index and read every indexed record completely. Produce one continuous natural Chinese Markdown master in single-column reading order. Do not use bilingual pairs, a fixed article JSON/template, source-position markers, the original two-column layout, or page breaks. Cover the main text, appendices, footnotes, and figure/table captions; keep reference entries in English. A natural paragraph may draw on several source records.',
      'Keep terminology, key numbers, and units consistent across the whole master. Use the original table crop as the table: never translate, reconstruct, or generatively redraw table interiors. Reference a task asset as ![translated caption](asset:ASSET_ID) and keep formulas or algorithms as clear original assets when text reproduction would be ambiguous.',
      'If necessary material is missing, ambiguous, or unrecoverable, do not guess. Add a short reader-visible note such as 待补 or 未核实 and list the record in unresolved with an actionable reason. Save the master with paper_task_write_branch using segments, terminology, and unresolved; reading every record alone does not prove translation accuracy.',
    ] : []),
    ...(branches.includes('deep-reading') ? [
      'For deep reading, independently analyze the original paper whether or not translation is selected or complete. Select an analysis framework suited to this paper from the pinned resources; synthesize the research problem, method, evidence, limitations, and applications into connected reasoning, not paragraph-by-paragraph translation or concatenated batch summaries. Use natural Markdown without a fixed five-section template or source-position markers. Distinguish reported facts from your inferences in reader-visible prose; connect important passages to the required internal claim/evidence entries. Do not guess from unverified crops, tables, formulas, or algorithms.',
      'Save a whole-paper Markdown main draft. If essential material or an asset is missing, ambiguous, unreadable, or unverified, include a reader-visible confirmation or uncompleted note and record the reason internally. Never claim quality approval or completion. Introduce each key factual passage as a paper-reported fact and each interpretation as an inference in the report language; associate those exact passages with claim_evidence. Labels such as 论文报告 / 分析推论 or Fact / Inference are supported without requiring fixed article headings.',
    ] : []),
    'After saving the branch preview, read it back completely and submit exactly one content review with paper_task_submit_content_review. If substantive findings exist, re-read only the cited source records and necessary context, then apply at most one local repair with paper_task_apply_local_repair. Do not save the generation again and do not start a second review. The application derives the final status; a clean structural check does not replace the content review, and a model stop does not waive any gate.',
    'Keep the existing preview.md and event behavior for compatibility. A saved preview is not itself a quality approval.',
  ].join('\n\n')
  writeFileSync(path, instructions, { flag: 'wx', mode: 0o444 })
  return path
}
