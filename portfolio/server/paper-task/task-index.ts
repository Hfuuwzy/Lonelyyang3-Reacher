import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  PAPER_TASK_BRANCHES,
  PAPER_TASK_HISTORY_STATUSES,
  paperTaskQualitySchema,
  paperTaskSelectionSchema,
  paperTaskStateSchema,
  type PaperTaskBranch,
  type PaperTaskEvent,
  type PaperTaskHistoryEntry,
} from '../../app/utils/paper-task-contract'

const INDEX_NAME = 'task-index.json'

const previewSnapshotSchema = z.object({
  branch: z.enum(PAPER_TASK_BRANCHES),
  designation: z.enum(['sample', 'generated-preview']),
  paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(8),
  quality: paperTaskQualitySchema.optional(),
}).strict()

const taskSnapshotSchema = z.object({
  taskId: z.string().uuid(),
  sourceTitle: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  selection: paperTaskSelectionSchema,
  status: z.enum(PAPER_TASK_HISTORY_STATUSES),
  deletionPending: z.literal(true).optional(),
  branches: z.object({
    translation: paperTaskStateSchema,
    'deep-reading': paperTaskStateSchema,
  }).strict(),
  cleanup: z.enum(['clean', 'failed']),
  previews: z.array(previewSnapshotSchema).max(PAPER_TASK_BRANCHES.length),
}).strict()

const taskIndexSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSnapshotSchema),
}).strict().superRefine((index, context) => {
  const taskIds = new Set<string>()
  for (const [taskIndex, task] of index.tasks.entries()) {
    if (taskIds.has(task.taskId)) {
      context.addIssue({ code: 'custom', message: 'task IDs must be unique', path: ['tasks', taskIndex, 'taskId'] })
    }
    taskIds.add(task.taskId)
    const previewBranches = new Set<PaperTaskBranch>()
    for (const [previewIndex, preview] of task.previews.entries()) {
      if (task.branches[preview.branch] === 'not-selected' || previewBranches.has(preview.branch)) {
        context.addIssue({ code: 'custom', message: 'task previews must be unique selected branches', path: ['tasks', taskIndex, 'previews', previewIndex] })
      }
      previewBranches.add(preview.branch)
    }
  }
})

export type PaperTaskPreviewSnapshot = z.infer<typeof previewSnapshotSchema>
export type StoredPaperTaskSnapshot = z.infer<typeof taskSnapshotSchema>

export function readPaperTaskIndex(projectRoot: string): readonly StoredPaperTaskSnapshot[] {
  const path = join(projectRoot, INDEX_NAME)
  if (!existsSync(path)) return []
  const parsed = taskIndexSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  return parsed.tasks
}

export function writePaperTaskIndex(projectRoot: string, tasks: readonly StoredPaperTaskSnapshot[]): void {
  const snapshot = taskIndexSchema.parse({ version: 1, tasks })
  mkdirSync(projectRoot, { recursive: true })
  const path = join(projectRoot, INDEX_NAME)
  const temporary = join(projectRoot, `.${INDEX_NAME}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function previewSnapshot(
  event: Extract<PaperTaskEvent, { type: 'preview' }>,
): PaperTaskPreviewSnapshot {
  return previewSnapshotSchema.parse({
    branch: event.branch,
    designation: event.designation,
    paragraphs: [...event.paragraphs],
    ...(event.quality === undefined ? {} : { quality: event.quality }),
  })
}

export function restoredTaskSnapshot(snapshot: StoredPaperTaskSnapshot): StoredPaperTaskSnapshot {
  const unfinishedBranchExists = Object.values(snapshot.branches).some((state) => state === 'running' || state === 'pending')
  if (snapshot.status !== 'running' && !unfinishedBranchExists) return snapshot

  const branchState = (branch: PaperTaskBranch): PaperTaskHistoryEntry['branches'][PaperTaskBranch] => {
    const state = snapshot.branches[branch]
    return state === 'running' || state === 'pending' ? 'interrupted' : state
  }
  return {
    ...snapshot,
    status: snapshot.status === 'running' ? 'interrupted' : snapshot.status,
    branches: {
      translation: branchState('translation'),
      'deep-reading': branchState('deep-reading'),
    },
  }
}

export function outcomeForHistoryStatus(status: PaperTaskHistoryEntry['status']): 'succeeded' | 'failed' | 'cancelled' | 'interrupted' {
  switch (status) {
    case 'success': return 'succeeded'
    case 'fail': return 'failed'
    case 'stopped': return 'cancelled'
    case 'running':
    case 'interrupted': return 'interrupted'
  }
}
