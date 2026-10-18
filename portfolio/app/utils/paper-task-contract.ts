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

/**
 * Settled branch states. `preview-ready` means readable content exists but the
 * single content review or an applicable check is still missing.
 * `needs-confirmation` means a readable result retains a substantive doubt that
 * requires maintainer judgement. `complete` is reserved for a result whose
 * one content review finished and whose independent structural checks found no
 * substantive issue. No preview designation can claim completion.
 */
export const PAPER_TASK_STATES = ['not-selected', 'pending', 'running', 'sample-ready', 'preview-ready', 'needs-confirmation', 'complete', 'failed', 'cancelled'] as const
export type PaperTaskState = (typeof PAPER_TASK_STATES)[number]

/** Quality states carried by a generated preview; never a task outcome. */
export const PAPER_TASK_QUALITY_STATES = ['preview', 'needs-confirmation', 'complete'] as const
export type PaperTaskQualityState = (typeof PAPER_TASK_QUALITY_STATES)[number]

/** Application-defined handling choices; the client maps them to labels. */
export const PAPER_TASK_QUALITY_OPTIONS = ['keep-readable', 'inspect-source', 'regenerate'] as const
export type PaperTaskQualityOption = (typeof PAPER_TASK_QUALITY_OPTIONS)[number]

export const PAPER_TASK_QUALITY_LIMITS = {
  maxIssues: 20,
  maxIssueLength: 500,
  maxOptions: 4,
} as const

export const PAPER_TASK_OUTCOMES = ['succeeded', 'failed', 'cancelled', 'disconnected'] as const
export type PaperTaskOutcome = (typeof PAPER_TASK_OUTCOMES)[number]

/** Designations a preview may carry. `sample` means unfinished; a
 * `generated-preview` may additionally carry a bounded quality result, but the
 * designation itself never claims completion. */
export const PAPER_TASK_DESIGNATIONS = ['sample', 'generated-preview'] as const
export type PaperTaskDesignation = (typeof PAPER_TASK_DESIGNATIONS)[number]

/**
 * A bounded, application-defined quality result for one branch. `issues` are
 * short reader-facing descriptions; `options` are stable identifiers rather
 * than executable instructions or URLs.
 */
export const paperTaskQualitySchema = z.object({
  status: z.enum(PAPER_TASK_QUALITY_STATES),
  issues: z.array(z.string().min(1).max(PAPER_TASK_QUALITY_LIMITS.maxIssueLength))
    .max(PAPER_TASK_QUALITY_LIMITS.maxIssues).readonly(),
  options: z.array(z.enum(PAPER_TASK_QUALITY_OPTIONS))
    .max(PAPER_TASK_QUALITY_LIMITS.maxOptions).readonly(),
}).strict().readonly()
export type PaperTaskQuality = z.infer<typeof paperTaskQualitySchema>

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
  quality: paperTaskQualitySchema.optional(),
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
  succeeded: new Set(['complete', 'needs-confirmation', 'preview-ready', 'sample-ready', 'not-selected']),
  failed: new Set(['complete', 'needs-confirmation', 'preview-ready', 'sample-ready', 'failed', 'not-selected']),
  cancelled: new Set(['complete', 'needs-confirmation', 'preview-ready', 'sample-ready', 'failed', 'cancelled', 'not-selected']),
  disconnected: new Set(['complete', 'needs-confirmation', 'preview-ready', 'sample-ready', 'failed', 'cancelled', 'not-selected']),
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
      if (!selected.includes(data.branch)) {
        return false
      }
      // A sample can never carry a quality result; quality belongs to a
      // generated preview that has a retained publication to review.
      return data.quality === undefined || data.designation === 'generated-preview'
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
