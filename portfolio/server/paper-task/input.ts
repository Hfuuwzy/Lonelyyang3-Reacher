import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PaperTaskSelection } from '../../app/utils/paper-task-contract'

export function writeTaskInput(root: string, taskId: string, selection: PaperTaskSelection): string {
  const path = join(root, 'task-input.md')
  writeFileSync(path, [
    `Task: ${taskId}\nSelected branches: ${selection}`,
    '## Prepared material',
    'The complete original PDF is prepared once as source.md, shared by all selected branches. It preserves extracted original text, page locations, source uncertainty and controlled original-asset links. Read this Markdown file, not internal extraction records. No source.txt is generated or needed. Reuse preparation rather than rerunning PDF conversion.',
    '## Selected skill',
    'Read the active branch\'s SKILL.md first. Follow its own workflow, linked references and quality standards; load resources relative to the referring skill document as needed. Do not force every framework, a fixed report template, or fact/inference label prefixes. When a different skill is selected, its instructions replace the previous methodology. The user task and safety/capability constraints still apply.',
    '## User task',
    'Write reader-facing output in Simplified Chinese. A translation branch produces one continuous whole-paper Markdown translation. An analysis branch produces an analysis report according to its selected skill. Keep facts, interpretations and uncertain source material distinguishable through appropriate natural writing; do not fabricate quotes, measurements or visual understanding.',
    '## Available capabilities',
    'Available: read/search the prepared Markdown; read approved selected-skill text resources; publish Markdown; perform one content review and at most one targeted repair. Original crops may be supplied only when image input is enabled. An asset link, visible crop or successful image transport does not prove visual understanding. Scripts are readable text but cannot be executed. Shell, web browsing, external research, OCR, and document construction are unavailable through this task interface. Disclose required unsupported steps as limitations.',
    '## Publication and review',
    'Use paper_task_write_branch with the complete manuscript as markdown and specific limitations. No source_record_ids, per-record translation segments or mandatory claim ledger are required. A successful write publishes once. Read back the saved manuscript, derive review criteria from the selected skill and task, then submit criteria, assessment and findings. Source delivery receipts establish provenance, not semantic correctness. Never claim quality approval just because a file was saved.',
  ].join('\n\n'), { flag: 'wx', mode: 0o444 })
  return path
}
