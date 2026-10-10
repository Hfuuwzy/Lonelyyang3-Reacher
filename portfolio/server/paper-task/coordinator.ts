/**
 * In-memory coordinator for sample-only local paper tasks (issue #40).
 *
 * `submit` persists the original PDF into the retained project-local workspace
 * and returns a wire-event stream that runs the selected branches
 * independently. `cancel` and `remove` stop every owned runtime and await
 * cleanup before reporting an action result; a failed cleanup blocks deletion.
 * Handles live only in memory for the lifetime of the task — no history, list,
 * replay, or recovery.
 */

import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import {
  paperTaskSelectionSchema,
  type PaperTaskActionResult,
  type PaperTaskEvent,
} from '../../app/utils/paper-task-contract'
import type { PaperTaskMultipartInput } from './multipart'
import {
  createPaperTaskWorkspace,
  removePaperTaskWorkspace,
} from './workspace'
import {
  createSampleProcessRuntimeFactory,
  type PaperTaskRuntimeFactory,
} from './runtime'
import { finalizeHandle, makeHandle, requestStop, type PaperTaskHandle } from './handle'
import {
  createTaskEvents,
  type ExtractPaperPages,
} from './stream'

const SAFE_CREATE_MESSAGE = '任务工作区创建失败，请稍后重试。'
const SAFE_SELECTION_MESSAGE = '任务分支选择不受支持，请选择翻译、深读或两者。'

export interface PaperTaskServiceDependencies {
  readonly runtimeFactory?: PaperTaskRuntimeFactory
  readonly extractPaperPages?: ExtractPaperPages
  readonly createId?: () => string
  readonly projectRoot?: string
}

export type PaperTaskSubmitResult =
  | { readonly ok: true; readonly taskId: string; readonly events: AsyncIterable<PaperTaskEvent> }
  | { readonly ok: false; readonly statusCode: number; readonly message: string }

export interface PaperTaskService {
  submit(input: PaperTaskMultipartInput, options?: { readonly signal?: AbortSignal }): Promise<PaperTaskSubmitResult>
  cancel(taskId: string): Promise<PaperTaskActionResult>
  remove(taskId: string): Promise<PaperTaskActionResult>
}

export function createPaperTaskService(
  dependencies: PaperTaskServiceDependencies = {},
): PaperTaskService {
  const runtimeFactory = dependencies.runtimeFactory ?? createSampleProcessRuntimeFactory()
  const extractPaperPages = dependencies.extractPaperPages ?? defaultExtractPaperPages
  const createId = dependencies.createId ?? (() => randomUUID())
  const projectRoot = dependencies.projectRoot ?? resolve(process.cwd(), '.data', 'paper-tasks')
  const store = new Map<string, PaperTaskHandle>()

  async function submit(
    input: PaperTaskMultipartInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<PaperTaskSubmitResult> {
    const selection = paperTaskSelectionSchema.safeParse(input.selection)
    if (!selection.success) {
      return { ok: false, statusCode: 400, message: SAFE_SELECTION_MESSAGE }
    }
    const taskId = createId()
    const workspaceRoot = join(projectRoot, 'project-local', taskId)
    const runtimeRoot = join(projectRoot, 'runtime-local', taskId)
    try {
      createPaperTaskWorkspace(workspaceRoot, input.pdf)
    } catch {
      return { ok: false, statusCode: 500, message: SAFE_CREATE_MESSAGE }
    }

    const handle = makeHandle(taskId, selection.data, workspaceRoot, runtimeRoot, options.signal)
    store.set(taskId, handle)
    return {
      ok: true,
      taskId,
      events: createTaskEvents(handle, input, runtimeFactory, extractPaperPages),
    }
  }

  async function cancel(taskId: string): Promise<PaperTaskActionResult> {
    const handle = store.get(taskId)
    if (handle === undefined) {
      return { ok: false, code: 'not-found' }
    }
    requestStop(handle, 'cancel')
    await waitSettled(handle)
    return handle.cleanupFailed
      ? { ok: false, code: 'cleanup-failed' }
      : { ok: true, code: 'stopped' }
  }

  async function remove(taskId: string): Promise<PaperTaskActionResult> {
    const handle = store.get(taskId)
    if (handle === undefined) {
      return { ok: false, code: 'not-found' }
    }
    requestStop(handle, 'cancel')
    await waitSettled(handle)
    if (handle.cleanupFailed) {
      return { ok: false, code: 'cleanup-failed' }
    }
    try {
      removePaperTaskWorkspace(handle.workspaceRoot)
    } catch {
      return { ok: false, code: 'cleanup-failed' }
    }
    store.delete(taskId)
    return { ok: true, code: 'deleted' }
  }

  return { submit, cancel, remove }
}

/**
 * Await the stream's settlement when it actually started. A stream created but
 * never consumed (e.g. the SSE writer failed before its first pull) never
 * settles; in that case stop the task inline so cancel/remove cannot hang.
 */
async function waitSettled(handle: PaperTaskHandle): Promise<void> {
  if (!handle.started) {
    await finalizeHandle(handle)
    return
  }
  await handle.settled
}

async function defaultExtractPaperPages(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ExtractPaperPages>>> {
  const { extractPaperPages } = await import('../utils/paper-review/pdf')
  return extractPaperPages(bytes, signal)
}
