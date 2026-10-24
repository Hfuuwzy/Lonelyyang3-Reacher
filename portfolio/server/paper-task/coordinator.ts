/**
 * Project-local coordinator for paper tasks (issue #40, #61, #62).
 *
 * `submit` persists the original PDF into the retained project-local workspace
 * and starts a service-owned producer for the selected branches independently.
 * A bounded task index and source state are retained with the task workspace;
 * reconnecting after restart replays a settled snapshot but never starts another
 * run. `cancel` and `remove` stop every owned runtime and await cleanup before
 * reporting an action result. Removal persists an explicit tombstone until
 * owned workspaces are gone, so failed cleanup remains visible and can be
 * retried after restart. Running tasks recover as interrupted; no runtime or
 * provider settings are resumed.
 */

import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import {
  paperTaskSelectionSchema,
  type PaperTaskActionResult,
  type PaperTaskBranch,
  type PaperTaskEvent,
  type PaperTaskHistoryEntry,
  type PaperTaskQuality,
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
import { closeRuntime, makeHandle, requestStop, type PaperTaskHandle } from './handle'
import { createRecoveredTaskEvents, createTaskEvents } from './stream'
import { createPaperTaskSourceStore, type StoredSource } from './source-store'
import { correctPaperTaskSource, type PaperTaskCorrection, type PaperTaskCorrectionResult } from './source-correction'
import { readPaperTaskTranslation } from './translation-access'
import type { PaperTaskTranslationView } from '../../app/utils/paper-task-translation-contract'
import { readPaperTaskReader, type PaperTaskReaderPreviewMetadata } from './reader-access'
import { readPaperTaskOriginalPdf, readPaperTaskTranslatedPdf } from './pdf-access'
import type { PaperTaskReaderView } from '../../app/utils/paper-task-reader-contract'
import {
  buildPaperTaskFormat,
  readPaperTaskArtifact,
  submitPaperTaskFormatInspection,
  type PaperTaskExportAsset,
  type PaperTaskExportFormat,
  type PaperTaskFormatInspection,
} from './artifact-export'
import { paperTaskBranchQuality, paperTaskDocumentQuality, type PaperTaskBranchQualityState } from './format-gate'
import {
  outcomeForHistoryStatus,
  previewSnapshot,
  readPaperTaskIndex,
  restoredTaskSnapshot,
  writePaperTaskIndex,
  type PaperTaskPreviewSnapshot,
  type StoredPaperTaskSnapshot,
} from './task-index'

const SAFE_CREATE_MESSAGE = '任务工作区创建失败，请稍后重试。'
const SAFE_SELECTION_MESSAGE = '任务分支选择不受支持，请选择翻译、深读或两者。'
const SAFE_PROVIDER_MESSAGE = '请先配置论文任务 API 的提供方、接口协议和模型；如服务商要求鉴权，也请填写 API 密钥。'

export interface PaperTaskServiceDependencies {
  readonly runtimeFactory?: PaperTaskRuntimeFactory
  readonly prepareSource?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperTaskSourceResult>
  readonly createId?: () => string
  readonly projectRoot?: string
  /** Narrow filesystem seam for proving owned-workspace deletion and retry behavior. */
  readonly removeWorkspace?: (workspaceRoot: string) => void
}

export type PaperTaskSubmitResult =
  | { readonly ok: true; readonly taskId: string; readonly events: AsyncIterable<PaperTaskEvent> }
  | { readonly ok: false; readonly statusCode: number; readonly message: string }

export interface PaperTaskService {
  submit(
    input: PaperTaskPdfInput,
    options?: { readonly preparedSource?: PreparedPaperTaskSource; readonly sourceTitle?: string },
  ): Promise<PaperTaskSubmitResult>
  cancel(taskId: string): Promise<PaperTaskActionResult>
  remove(taskId: string): Promise<PaperTaskActionResult>
  history(): readonly PaperTaskHistoryEntry[]
  events(taskId: string): AsyncIterable<PaperTaskEvent> | undefined
  source(taskId: string): StoredSource | undefined
  translation(taskId: string): PaperTaskTranslationView | undefined
  reader(taskId: string): PaperTaskReaderView | undefined
  buildArtifacts(taskId: string, branch: PaperTaskBranch, formats: readonly PaperTaskExportFormat[]): Promise<PaperTaskReaderView | undefined>
  artifact(taskId: string, branch: PaperTaskBranch, format: PaperTaskExportFormat, purpose?: 'final' | 'inspection'): Buffer | undefined
  inspectArtifact(taskId: string, branch: PaperTaskBranch, format: 'pdf', inspection: PaperTaskFormatInspection): Promise<PaperTaskReaderView | undefined>
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
  const removeWorkspace = dependencies.removeWorkspace ?? removePaperTaskWorkspace
  const store = new Map<string, PaperTaskHandle>()
  const taskEvents = new Map<string, AsyncIterable<PaperTaskEvent>>()
  const sourceStore = createPaperTaskSourceStore()
  const deleting = new Set<string>()
  const deletionPending = new Set<string>()
  const snapshots = new Map<string, StoredPaperTaskSnapshot>()
  const previews = new Map<string, Map<PaperTaskBranch, PaperTaskPreviewSnapshot>>()

  function snapshotFor(handle: PaperTaskHandle): StoredPaperTaskSnapshot {
    const snapshot: StoredPaperTaskSnapshot = {
      taskId: handle.taskId,
      sourceTitle: handle.sourceTitle,
      createdAt: handle.createdAt,
      selection: handle.selection,
      status: historyStatus(handle),
      branches: { ...handle.branches },
      cleanup: handle.cleanupFailed ? 'failed' : 'clean',
      previews: [...(previews.get(handle.taskId)?.values() ?? [])],
    }
    return deletionPending.has(handle.taskId) ? { ...snapshot, deletionPending: true } : snapshot
  }

  function persist(handle: PaperTaskHandle): void {
    const snapshot = snapshotFor(handle)
    snapshots.set(handle.taskId, snapshot)
    writePaperTaskIndex(projectRoot, [...snapshots.values()])
  }

  let recoveredRunningTask = false
  for (const stored of readPaperTaskIndex(projectRoot)) {
    const snapshot = restoredTaskSnapshot(stored)
    recoveredRunningTask ||= snapshot !== stored
    if (snapshot.deletionPending) deletionPending.add(snapshot.taskId)
    const handle = makeHandle(
      snapshot.taskId,
      snapshot.selection,
      join(projectRoot, 'project-local', snapshot.taskId),
      join(projectRoot, 'runtime-local', snapshot.taskId),
      snapshot.sourceTitle,
      snapshot.createdAt,
    )
    handle.branches.translation = snapshot.branches.translation
    handle.branches['deep-reading'] = snapshot.branches['deep-reading']
    handle.cleanupFailed = snapshot.cleanup === 'failed'
    handle.anyFailed = Object.values(snapshot.branches).includes('failed')
    handle.outcome = outcomeForHistoryStatus(snapshot.status)
    handle.finalized = true
    handle.settle()
    store.set(snapshot.taskId, handle)
    snapshots.set(snapshot.taskId, snapshot)
    previews.set(snapshot.taskId, new Map(snapshot.previews.map((preview) => [preview.branch, preview])))
    sourceStore.restore(snapshot.taskId, handle.workspaceRoot)
    taskEvents.set(snapshot.taskId, createRecoveredTaskEvents(snapshot))
  }
  if (recoveredRunningTask) writePaperTaskIndex(projectRoot, [...snapshots.values()])

  function workspaceRoot(taskId: string): string {
    return join(projectRoot, 'project-local', taskId)
  }

  async function submit(
    input: PaperTaskPdfInput,
    options: { readonly preparedSource?: PreparedPaperTaskSource; readonly sourceTitle?: string } = {},
  ): Promise<PaperTaskSubmitResult> {
    const selection = paperTaskSelectionSchema.safeParse(input.selection)
    if (!selection.success) {
      return { ok: false, statusCode: 400, message: SAFE_SELECTION_MESSAGE }
    }
    const taskId = createId()
    if (store.has(taskId)) {
      return { ok: false, statusCode: 409, message: '任务编号冲突，未覆盖已有任务；请稍后重试。' }
    }
    const retainedRoot = workspaceRoot(taskId)
    const runtimeRoot = join(projectRoot, 'runtime-local', taskId)
    const provider = runtimeFactory === undefined ? getPaperTaskProviderSettings() : undefined
    if (runtimeFactory === undefined && (provider === undefined || provider.providerLabel.length === 0 || provider.baseUrl.length === 0 || provider.model.length === 0)) {
      return { ok: false, statusCode: 409, message: SAFE_PROVIDER_MESSAGE }
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

    previews.set(taskId, new Map())
    let handle!: PaperTaskHandle
    handle = makeHandle(
      taskId,
      selection.data,
      retainedRoot,
      runtimeRoot,
      normalizeTaskTitle(options.sourceTitle),
      new Date().toISOString(),
      () => {
        try { persist(handle) } catch { /* a failed snapshot must not strand an owned runtime */ }
      },
    )
    store.set(taskId, handle)
    try {
      persist(handle)
    } catch {
      store.delete(taskId)
      snapshots.delete(taskId)
      previews.delete(taskId)
      try { removePaperTaskWorkspace(retainedRoot) } catch { /* keep the fixed submit error */ }
      return { ok: false, statusCode: 500, message: SAFE_CREATE_MESSAGE }
    }
    const events = createTaskEvents(
      handle,
      input,
      taskRuntimeFactory,
      prepareSource,
      sourceStore,
      unavailableBranches,
      options.preparedSource,
      (event) => {
        if (event.type !== 'preview') return
        previews.get(taskId)?.set(event.branch, previewSnapshot(event))
        try { persist(handle) } catch { /* preserve the task even if a later index write fails */ }
      },
    )
    taskEvents.set(taskId, events)
    return {
      ok: true,
      taskId,
      events,
    }
  }

  async function cancel(taskId: string): Promise<PaperTaskActionResult> {
    const handle = store.get(taskId)
    if (handle === undefined) {
      return { ok: false, code: 'not-found' }
    }
    requestStop(handle)
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
    if (!deletionPending.has(taskId)) {
      const previousSnapshot = snapshots.get(taskId)
      deletionPending.add(taskId)
      try {
        // The intent must reach the durable index before any runtime or task
        // workspace cleanup can make this task impossible to recover.
        persist(handle)
      } catch {
        deletionPending.delete(taskId)
        if (previousSnapshot === undefined) snapshots.delete(taskId)
        else snapshots.set(taskId, previousSnapshot)
        deleting.delete(taskId)
        return { ok: false, code: 'cleanup-failed' }
      }
    }
    requestStop(handle)
    await waitSettled(handle)
    if (handle.cleanupFailed) {
      await retryRuntimeCleanup(handle)
      if (handle.cleanupFailed) {
        deleting.delete(taskId)
        return { ok: false, code: 'cleanup-failed' }
      }
    }
    try {
      // A service restored after a process interruption has no live runtime
      // handles, but may still own a stale runtime-local task directory.
      removePaperTaskWorkspace(handle.runtimeRoot)
    } catch {
      deleting.delete(taskId)
      return { ok: false, code: 'cleanup-failed' }
    }
    try {
      // Keep the deletion tombstone indexed until the retained workspace is
      // gone. If index commit then fails, an explicit retry can finish cleanup.
      removeWorkspace(handle.workspaceRoot)
    } catch {
      deleting.delete(taskId)
      return { ok: false, code: 'cleanup-failed' }
    }
    const nextSnapshots = [...snapshots.values()].filter((snapshot) => snapshot.taskId !== taskId)
    try {
      writePaperTaskIndex(projectRoot, nextSnapshots)
    } catch {
      deleting.delete(taskId)
      return { ok: false, code: 'cleanup-failed' }
    }
    store.delete(taskId)
    taskEvents.delete(taskId)
    snapshots.delete(taskId)
    previews.delete(taskId)
    deletionPending.delete(taskId)
    sourceStore.forget(taskId)
    deleting.delete(taskId)
    return { ok: true, code: 'deleted' }
  }

  function history(): readonly PaperTaskHistoryEntry[] {
    return [...store.values()].reverse()
      .filter((handle) => !deleting.has(handle.taskId))
      .map((handle) => {
        const fragments = readerView(handle)?.documents.flatMap((document) =>
          document.status === 'fragment' ? [document.fragment] : [],
        ) ?? []
        return {
          taskId: handle.taskId,
          sourceTitle: handle.sourceTitle,
          createdAt: handle.createdAt,
          selection: handle.selection,
          status: historyStatus(handle),
          ...(deletionPending.has(handle.taskId) ? { deletionPending: true as const } : {}),
          branches: { ...handle.branches },
          ...(fragments.length === 0 ? {} : { fragments }),
        }
      })
  }

  function events(taskId: string): AsyncIterable<PaperTaskEvent> | undefined {
    if (deleting.has(taskId)) return undefined
    return taskEvents.get(taskId)
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
    return readerView(handle)
  }

  function readerView(handle: PaperTaskHandle): PaperTaskReaderView | undefined {
    const taskId = handle.taskId
    const stored = sourceStore.read(taskId, handle.workspaceRoot)
    const quality: Partial<Record<PaperTaskBranch, PaperTaskQuality>> = {}
    for (const preview of previews.get(taskId)?.values() ?? []) {
      if (preview.quality !== undefined) quality[preview.branch] = preview.quality
    }
    const metadata: PaperTaskReaderPreviewMetadata = { quality, taskOutcome: handle.outcome }
    return readPaperTaskReader(taskId, handle.workspaceRoot, handle.branches, stored, metadata)
  }

  function artifactContext(taskId: string, branch: PaperTaskBranch): {
    readonly handle: PaperTaskHandle
    readonly markdown: string
    readonly assets: readonly PaperTaskExportAsset[]
    readonly masterQuality: PaperTaskBranchQualityState
  } | undefined {
    if (deleting.has(taskId)) return undefined
    const handle = store.get(taskId)
    if (handle === undefined || !handle.finalized || handle.cleanupFailed || handle.branches[branch] === 'not-selected') return undefined
    const stored = sourceStore.read(taskId, handle.workspaceRoot)
    if (stored === undefined) return undefined
    const view = readPaperTaskReader(taskId, handle.workspaceRoot, handle.branches, stored)
    const document = view?.documents.find((candidate) => candidate.branch === branch)
    if (document === undefined || document.status === 'fragment') return undefined
    const masterQuality = paperTaskDocumentQuality(paperTaskBranchQuality(handle.branches[branch]), document.status)
    const assets = document.assets.map((asset): PaperTaskExportAsset => {
      const bytes = asset.availability === 'available'
        ? sourceStore.readAsset(taskId, handle.workspaceRoot, asset.id)
        : undefined
      return { id: asset.id, caption: asset.caption, ...(bytes === undefined ? {} : { bytes }) }
    })
    return { handle, markdown: document.markdown, assets, masterQuality }
  }

  async function buildArtifacts(
    taskId: string,
    branch: PaperTaskBranch,
    formats: readonly PaperTaskExportFormat[],
  ): Promise<PaperTaskReaderView | undefined> {
    const context = artifactContext(taskId, branch)
    if (context === undefined || (branch === 'deep-reading' && formats.some((format) => format === 'pdf'))) return undefined
    for (const format of formats) {
      try {
        await buildPaperTaskFormat({
          root: context.handle.workspaceRoot, branch, format, markdown: context.markdown,
          assets: context.assets, masterQuality: context.masterQuality,
        })
      } catch {
        // A format's failure is retained independently and must not suppress the other requested formats.
      }
    }
    return reader(taskId)
  }

  function artifact(
    taskId: string,
    branch: PaperTaskBranch,
    format: PaperTaskExportFormat,
    purpose: 'final' | 'inspection' = 'final',
  ): Buffer | undefined {
    const context = artifactContext(taskId, branch)
    if (context === undefined) return undefined
    return readPaperTaskArtifact({
      root: context.handle.workspaceRoot, branch, format, markdown: context.markdown,
      masterQuality: context.masterQuality, purpose,
    })
  }

  async function inspectArtifact(
    taskId: string,
    branch: PaperTaskBranch,
    format: 'pdf',
    inspection: PaperTaskFormatInspection,
  ): Promise<PaperTaskReaderView | undefined> {
    const context = artifactContext(taskId, branch)
    if (context === undefined || branch !== 'translation') return undefined
    await submitPaperTaskFormatInspection({
      root: context.handle.workspaceRoot, branch, format, markdown: context.markdown,
      masterQuality: context.masterQuality, inspection,
    })
    return reader(taskId)
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
    const document = reader(taskId)?.documents.find((candidate) => candidate.branch === 'translation')
    if (document?.status !== 'complete' || !document.formats.pdf.finalAvailable) return undefined
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

  return { submit, cancel, remove, history, events, source, translation, reader, buildArtifacts, artifact, inspectArtifact, originalPdf, translatedPdf, asset, correctSource }
}

async function waitSettled(handle: PaperTaskHandle): Promise<void> {
  if (handle.execution !== undefined) {
    await handle.execution
    return
  }
  await handle.settled
}

async function retryRuntimeCleanup(handle: PaperTaskHandle): Promise<void> {
  const failedRuntimes = [...handle.runtimeCleanupFailures]
  handle.cleanupFailed = false
  for (const runtime of failedRuntimes) handle.runtimeClosures.delete(runtime)
  await Promise.all(failedRuntimes.map((runtime) => closeRuntime(handle, runtime)))
  if (handle.cleanupFailed) return
  try {
    removePaperTaskWorkspace(handle.runtimeRoot)
  } catch {
    handle.cleanupFailed = true
  }
}

function historyStatus(handle: PaperTaskHandle): PaperTaskHistoryEntry['status'] {
  switch (handle.outcome) {
    case 'succeeded': return 'success'
    case 'failed': return 'fail'
    case 'cancelled': return 'stopped'
    case 'interrupted': return 'interrupted'
    default: return 'running'
  }
}

function normalizeTaskTitle(title?: string): string {
  const normalized = title?.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 200)
  return normalized === undefined || normalized.length === 0 ? '上传的论文 PDF' : normalized
}

async function defaultPrepareSource(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<PaperTaskSourceResult> {
  const { preparePaperTaskSource } = await import('./source')
  return preparePaperTaskSource(bytes, signal)
}
