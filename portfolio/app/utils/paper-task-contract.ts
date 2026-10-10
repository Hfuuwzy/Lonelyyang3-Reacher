/**
 * Browser-safe shared wire contract for the paper task (issue #40, translation
 * and deep reading).
 *
 * Browser-safe: no DOM, fetch, or Node APIs — only literals, types, and pure
 * functions. The backend agent imports this exact file to shape its
 * `text/event-stream` payloads; the frontend imports it to validate every
 * inbound event at runtime. The task starts only the branches the reader
 * selected, reports branch states separately, and never labels a preview as a
 * complete artifact or as quality-passed.
 *
 * Events are a discriminated union on `type`: `accepted`, `progress`,
 * `preview`, and `terminal`. Every event carries the task UUID. A single
 * branch failure must not mask sibling outcomes: the `terminal` event reports
 * every branch state, `outcome` is the task-level result, and each outcome
 * admits only its legal branch-state combinations (unselected branches stay
 * `not-selected`, and no terminal ever carries an in-flight state: a
 * disconnect or cancel marks the unfinished branches `cancelled`).
 */

import { z } from 'zod'

export const PAPER_TASK_SELECTIONS = ['translation', 'deep-reading', 'both'] as const
export type PaperTaskSelection = (typeof PAPER_TASK_SELECTIONS)[number]

export const PAPER_TASK_BRANCHES = ['translation', 'deep-reading'] as const
export type PaperTaskBranch = (typeof PAPER_TASK_BRANCHES)[number]

export const PAPER_TASK_STAGES = ['preparing', 'generating', 'cleaning'] as const
export type PaperTaskStage = (typeof PAPER_TASK_STAGES)[number]

export const PAPER_TASK_STATES = ['not-selected', 'pending', 'running', 'sample-ready', 'failed', 'cancelled'] as const
export type PaperTaskState = (typeof PAPER_TASK_STATES)[number]

export const PAPER_TASK_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'disconnected'] as const
export type PaperTaskOutcome = (typeof PAPER_TASK_OUTCOMES)[number]

/** Designations a preview may carry. `sample` means unfinished; there is no
 * `complete` or `passed` designation on the wire. */
export const PAPER_TASK_DESIGNATIONS = ['sample'] as const
export type PaperTaskDesignation = (typeof PAPER_TASK_DESIGNATIONS)[number]

/** Per-preview paragraph bounds shared by the backend and the frontend. */
export const PAPER_TASK_PREVIEW_PARAGRAPH_LIMITS = {
  maxParagraphs: 8,
  maxParagraphLength: 2000,
} as const

export const PAPER_TASK_ACTION_RESULT_CODES = ['stopped', 'deleted', 'cleanup-failed', 'not-found'] as const
export type PaperTaskActionResultCode = (typeof PAPER_TASK_ACTION_RESULT_CODES)[number]

export type PaperTaskBranches = Record<PaperTaskBranch, PaperTaskState>

export const paperTaskSelectionSchema = z.enum(PAPER_TASK_SELECTIONS)
export const paperTaskBranchSchema = z.enum(PAPER_TASK_BRANCHES)
export const paperTaskStageSchema = z.enum(PAPER_TASK_STAGES)
export const paperTaskStateSchema = z.enum(PAPER_TASK_STATES)
export const paperTaskOutcomeSchema = z.enum(PAPER_TASK_OUTCOMES)
export const paperTaskDesignationSchema = z.enum(PAPER_TASK_DESIGNATIONS)

/** A UUID string identifying one paper task across every event it emits. */
export const paperTaskIdSchema = z.string().uuid()

/**
 * Branches selected by a request, in fixed display order. `translation`
 * activates only the translation branch, `deep-reading` only the deep-reading
 * branch, and `both` activates both.
 */
export function getSelectedBranches(selection: PaperTaskSelection): readonly PaperTaskBranch[] {
  switch (selection) {
    case 'translation':
      return ['translation']
    case 'deep-reading':
      return ['deep-reading']
    case 'both':
      return ['translation', 'deep-reading']
    default:
      return assertNever(selection)
  }
}

/**
 * Initial per-branch states for a selection: every selected branch starts
 * `pending`, every unselected branch is `not-selected`.
 */
export function initialBranchStates(selection: PaperTaskSelection): PaperTaskBranches {
  const branches: PaperTaskBranches = { translation: 'not-selected', 'deep-reading': 'not-selected' }
  for (const branch of getSelectedBranches(selection)) {
    branches[branch] = 'pending'
  }
  return branches
}

const progressBranchSchema = paperTaskBranchSchema.nullable()

const acceptedEventSchema = z.object({
  type: z.literal('accepted'),
  taskId: paperTaskIdSchema,
  selection: paperTaskSelectionSchema,
}).passthrough()

const progressEventSchema = z.object({
  type: z.literal('progress'),
  taskId: paperTaskIdSchema,
  stage: paperTaskStageSchema,
  branch: progressBranchSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
}).passthrough()

const previewEventSchema = z.object({
  type: z.literal('preview'),
  taskId: paperTaskIdSchema,
  branch: paperTaskBranchSchema,
  designation: paperTaskDesignationSchema,
  paragraphs: z.array(z.string().min(1).max(PAPER_TASK_PREVIEW_PARAGRAPH_LIMITS.maxParagraphLength))
    .min(1)
    .max(PAPER_TASK_PREVIEW_PARAGRAPH_LIMITS.maxParagraphs),
}).passthrough()

/** Exactly the two branches of this wire contract; unknown branch keys rejected. */
const branchStatesSchema = z.object({
  translation: paperTaskStateSchema,
  'deep-reading': paperTaskStateSchema,
})

/**
 * Per-outcome legality of branch states, derived from the acceptance criteria:
 * unselected branches must stay `not-selected`, a single branch failure must
 * not mask siblings, and no terminal ever leaves a branch in-flight — a
 * disconnect or cancel marks the unfinished branches `cancelled`. A cancel may
 * also arrive while the task is cleaning up, in which case every sample is
 * retained (`sample-ready`) and no branch needs to be `cancelled`; likewise a
 * cancel may land on a task whose sibling branch already failed.
 */
const PAPER_TASK_TERMINAL_STATE_RULES: Record<PaperTaskOutcome, ReadonlySet<PaperTaskState>> = {
  succeeded: new Set(['sample-ready', 'not-selected']),
  failed: new Set(['failed', 'sample-ready', 'not-selected']),
  cancelled: new Set(['cancelled', 'failed', 'sample-ready', 'not-selected']),
  disconnected: new Set(['cancelled', 'failed', 'sample-ready', 'not-selected']),
}

const terminalEventSchema = z.object({
  type: z.literal('terminal'),
  taskId: paperTaskIdSchema,
  outcome: paperTaskOutcomeSchema,
  branches: branchStatesSchema,
  cleanup: z.enum(['clean', 'failed']),
}).passthrough()

export const paperTaskEventSchema = z.discriminatedUnion('type', [
  acceptedEventSchema,
  progressEventSchema,
  previewEventSchema,
  terminalEventSchema,
]).superRefine((event, ctx) => {
  switch (event.type) {
    case 'progress':
      if (event.completed > event.total) {
        ctx.addIssue({ code: 'custom', message: 'completed must not exceed total', path: ['completed'] })
      }
      return
    case 'terminal': {
      const allowed = PAPER_TASK_TERMINAL_STATE_RULES[event.outcome]
      const states: PaperTaskState[] = [event.branches.translation, event.branches['deep-reading']]
      for (const state of states) {
        if (!allowed.has(state)) {
          ctx.addIssue({ code: 'custom', message: `branch state ${state} is not legal for outcome ${event.outcome}` })
        }
      }
      return
    }
    default:
      return
  }
})

export type PaperTaskEvent = z.infer<typeof paperTaskEventSchema>

/**
 * Action result for stopping, deleting, or cleaning a task. Valid combinations
 * are discriminated: `ok: true` only with `stopped` or `deleted`; `ok: false`
 * only with `cleanup-failed` or `not-found`.
 */
export const paperTaskActionResultSchema: z.ZodType<PaperTaskActionResult> = z.discriminatedUnion('code', [
  z.object({ ok: z.literal(true), code: z.literal('stopped') }).passthrough(),
  z.object({ ok: z.literal(true), code: z.literal('deleted') }).passthrough(),
  z.object({ ok: z.literal(false), code: z.literal('cleanup-failed') }).passthrough(),
  z.object({ ok: z.literal(false), code: z.literal('not-found') }).passthrough(),
])

export interface PaperTaskActionResult {
  readonly ok: boolean
  readonly code: PaperTaskActionResultCode
}

/** Validates a raw event against the wire contract and the requested selection. */
export function validatePaperTaskEvent(event: unknown, selection: PaperTaskSelection): boolean {
  const parsed = paperTaskEventSchema.safeParse(event)
  if (!parsed.success) {
    return false
  }
  const data = parsed.data
  const selected = getSelectedBranches(selection)
  switch (data.type) {
    case 'accepted':
      return data.selection === selection
    case 'progress':
      return data.branch === null || selected.includes(data.branch)
    case 'preview':
      return selected.includes(data.branch)
    case 'terminal':
      return terminalBranchesSatisfySelection(data.branches, selection)
    default:
      return assertNever(data)
  }
}

function terminalBranchesSatisfySelection(
  branches: Record<PaperTaskBranch, PaperTaskState>,
  selection: PaperTaskSelection,
): boolean {
  const selected = getSelectedBranches(selection)
  const unselected = PAPER_TASK_BRANCHES.filter((branch) => !selected.includes(branch))
  return unselected.every((branch) => branches[branch] === 'not-selected')
    && selected.every((branch) => branches[branch] !== 'not-selected')
}

function assertNever(value: never): never {
  throw new Error(`unreachable paper task value: ${String(value)}`)
}
