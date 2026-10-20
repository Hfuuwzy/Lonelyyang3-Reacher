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
import type { PaperTaskPdfInput } from './multipart'
import type { PreparedPaperTaskSource } from './source-acquisition'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'
import {
  createPaperTaskWorkspace,
  removePaperTaskWorkspace,
} from './workspace'
import {
  type PaperTaskRuntimeFactory,
} from './runtime'
import { createDshRuntimeFactory } from './dsh-runtime'
import { getPaperTaskProviderSettings } from './provider-settings'
import { getSelectedBranches } from '../../app/utils/paper-task-contract'
import { snapshotGenerationResources } from './generation-resources'
import { writeTaskInput } from './input'
import { finalizeHandle, makeHandle, requestStop, type PaperTaskHandle } from './handle'
import {
  createTaskEvents,
} from './stream'
import { createPaperTaskSourceStore, type StoredSource } from './source-store'
import { correctPaperTaskSource, type PaperTaskCorrection, type PaperTaskCorrectionResult } from './source-correction'
import { readPaperTaskTranslation } from './translation-access'
import type { PaperTaskTranslationView } from '../../app/utils/paper-task-translation-contract'
import { readPaperTaskReader } from './reader-access'
import { readPaperTaskOriginalPdf, readPaperTaskTranslatedPdf } from './pdf-access'
import type { PaperTaskReaderView } from '../../app/utils/paper-task-reader-contract'

const SAFE_CREATE_MESSAGE = '任务工作区创建失败，请稍后重试。'
const SAFE_SELECTION_MESSAGE = '任务分支选择不受支持，请选择翻译、深读或两者。'
const SAFE_PROVIDER_MESSAGE = '请先配置论文任务的模型提供方、接口协议和模型，再提交生成预览。'

export interface PaperTaskServiceDependencies {
  readonly runtimeFactory?: PaperTaskRuntimeFactory
  readonly prepareSource?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperTaskSourceResult>
  readonly createId?: () => string
  readonly projectRoot?: string
}

export type PaperTaskSubmitResult =
  | { readonly ok: true; readonly taskId: string; readonly events: AsyncIterable<PaperTaskEvent> }
  | { readonly ok: false; readonly statusCode: number; readonly message: string }

export interface PaperTaskService {
  submit(
    input: PaperTaskPdfInput,
    options?: { readonly signal?: AbortSignal; readonly preparedSource?: PreparedPaperTaskSource },
  ): Promise<PaperTaskSubmitResult>
  cancel(taskId: string): Promise<PaperTaskActionResult>
  remove(taskId: string): Promise<PaperTaskActionResult>
  source(taskId: string): StoredSource | undefined
  translation(taskId: string): PaperTaskTranslationView | undefined
  reader(taskId: string): PaperTaskReaderView | undefined
  originalPdf(taskId: string): Uint8Array | undefined
  translatedPdf(taskId: string): Uint8Array | undefined
  asset(taskId: string, assetId: string): Uint8Array | undefined
  correctSource(taskId: string, input: PaperTaskCorrection): PaperTaskCorrectionResult
}

export function createPaperTaskService(
  dependencies: PaperTaskServiceDependencies = {},
): PaperTaskService {
  const runtimeFactory = dependencies.runtimeFactory
  const prepareSource = dependencies.prepareSource ?? defaultPrepareSource
  const createId = dependencies.createId ?? (() => randomUUID())
  const projectRoot = dependencies.projectRoot ?? resolve(process.cwd(), '.data', 'paper-tasks')
  const store = new Map<string, PaperTaskHandle>()
  const sourceStore = createPaperTaskSourceStore()
  const deleting = new Set<string>()

  function workspaceRoot(taskId: string): string {
    return join(projectRoot, 'project-local', taskId)
  }

  async function submit(
    input: PaperTaskPdfInput,
    options: { readonly signal?: AbortSignal; readonly preparedSource?: PreparedPaperTaskSource } = {},
  ): Promise<PaperTaskSubmitResult> {
    const selection = paperTaskSelectionSchema.safeParse(input.selection)
    if (!selection.success) {
      return { ok: false, statusCode: 400, message: SAFE_SELECTION_MESSAGE }
    }
    const taskId = createId()
    const retainedRoot = workspaceRoot(taskId)
    const runtimeRoot = join(projectRoot, 'runtime-local', taskId)
    const provider = runtimeFactory === undefined ? getPaperTaskProviderSettings() : undefined
    if (runtimeFactory === undefined && (provider === undefined || provider.providerLabel.length === 0 || provider.baseUrl.length === 0 || provider.model.length === 0)) {
      return { ok: false, statusCode: 400, message: SAFE_PROVIDER_MESSAGE }
    }
    try {
      createPaperTaskWorkspace(retainedRoot, input.pdf)
    } catch {
      return { ok: false, statusCode: 500, message: SAFE_CREATE_MESSAGE }
    }

    let taskRuntimeFactory = runtimeFactory
    let unavailableBranches: readonly ('translation' | 'deep-reading')[] = []
    if (provider !== undefined) {
      try {
        const selected = getSelectedBranches(selection.data)
        const resourceSnapshot = snapshotGenerationResources(retainedRoot, selected)
        unavailableBranches = resourceSnapshot.unavailableBranches
        const taskInputPath = writeTaskInput(retainedRoot, taskId, selection.data)
        taskRuntimeFactory = createDshRuntimeFactory({
          provider,
          workspaceRoot: retainedRoot,
          taskInputPath,
          resourcesRoot: join(retainedRoot, 'generation-resources'),
        })
      } catch {
        return { ok: false, statusCode: 500, message: SAFE_CREATE_MESSAGE }
      }
    }
    if (taskRuntimeFactory === undefined) {
      return { ok: false, statusCode: 500, message: SAFE_CREATE_MESSAGE }
    }

    const handle = makeHandle(taskId, selection.data, retainedRoot, runtimeRoot, options.signal)
    store.set(taskId, handle)
    return {
      ok: true,
      taskId,
      events: createTaskEvents(
        handle,
        input,
        taskRuntimeFactory,
        prepareSource,
        sourceStore,
        unavailableBranches,
        options.preparedSource,
      ),
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
    if (handle === undefined || deleting.has(taskId)) {
      return { ok: false, code: 'not-found' }
    }
    deleting.add(taskId)
    requestStop(handle, 'cancel')
    await waitSettled(handle)
    if (handle.cleanupFailed) {
      deleting.delete(taskId)
      return { ok: false, code: 'cleanup-failed' }
    }
    try {
      removePaperTaskWorkspace(handle.workspaceRoot)
    } catch {
      deleting.delete(taskId)
      return { ok: false, code: 'cleanup-failed' }
    }
    store.delete(taskId)
    sourceStore.forget(taskId)
    deleting.delete(taskId)
    return { ok: true, code: 'deleted' }
  }

  function source(taskId: string): StoredSource | undefined {
    if (deleting.has(taskId)) return undefined
    return sourceStore.read(taskId, workspaceRoot(taskId))
  }

  function translation(taskId: string): PaperTaskTranslationView | undefined {
    if (deleting.has(taskId)) return undefined
    const handle = store.get(taskId)
    if (handle === undefined) return undefined
    if (sourceStore.read(taskId, handle.workspaceRoot) === undefined) return undefined
    return readPaperTaskTranslation(taskId, handle.workspaceRoot)
  }

  function reader(taskId: string): PaperTaskReaderView | undefined {
    if (deleting.has(taskId)) return undefined
    const handle = store.get(taskId)
    if (handle === undefined) return undefined
    const stored = sourceStore.read(taskId, handle.workspaceRoot)
    if (stored === undefined) return undefined
    return readPaperTaskReader(taskId, handle.workspaceRoot, handle.branches, stored)
  }

  function originalPdf(taskId: string): Uint8Array | undefined {
    if (deleting.has(taskId)) return undefined
    const handle = store.get(taskId)
    if (handle === undefined) return undefined
    return readPaperTaskOriginalPdf(handle.workspaceRoot)
  }

  function translatedPdf(taskId: string): Uint8Array | undefined {
    if (deleting.has(taskId)) return undefined
    const handle = store.get(taskId)
    if (handle === undefined || handle.branches.translation !== 'complete') return undefined
    return readPaperTaskTranslatedPdf(handle.workspaceRoot, 'complete')
  }

  function asset(taskId: string, assetId: string): Uint8Array | undefined {
    if (deleting.has(taskId)) return undefined
    return sourceStore.readAsset(taskId, workspaceRoot(taskId), assetId)
  }

  function correctSource(taskId: string, correction: PaperTaskCorrection): PaperTaskCorrectionResult {
    const handle = store.get(taskId)
    if (handle === undefined || deleting.has(taskId) || !handle.finalized || handle.cleanupFailed) {
      return { kind: 'unavailable' }
    }
    return correctPaperTaskSource(sourceStore, taskId, handle.workspaceRoot, correction)
  }

  return { submit, cancel, remove, source, translation, reader, originalPdf, translatedPdf, asset, correctSource }
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

async function defaultPrepareSource(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<PaperTaskSourceResult> {
  const { preparePaperTaskSource } = await import('./source')
  return preparePaperTaskSource(bytes, signal)
}
