import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { z } from 'zod'
import {
  paperTaskActionResultSchema,
  paperTaskHistoryEntrySchema,
  type PaperTaskHistoryEntry,
} from '../utils/paper-task-contract'
import { createPaperTaskWorkbenchState, type PaperTaskWorkbenchState } from './paper-task-workbench-state'
import {
  createPaperTaskWorkbenchTransport,
  type PaperTaskSubmitRequest,
  type PaperTaskSubmitSource,
  type PaperTaskSubmitResult,
  type PaperTaskObserveRequest,
  type PaperTaskWorkbenchTransport,
} from './paper-task-workbench-transport'

export interface PaperTaskWorkbench extends PaperTaskWorkbenchState {
  readonly sourceUrl: Ref<string>
  readonly sourceFallbackAvailable: Ref<boolean>
  readonly providerSettingsRequired: Ref<boolean>
  readonly history: Ref<readonly PaperTaskHistoryEntry[]>
  readonly historyLoading: Ref<boolean>
  readonly historyError: Ref<string>
  readonly deletingTaskId: Ref<string | null>
  readonly observationFailed: Ref<boolean>
  readonly handleSubmit: () => Promise<void>
  readonly handleOpenHistory: (taskId: string) => Promise<void>
  readonly handleReconnect: () => Promise<void>
  readonly handleRefreshHistory: () => Promise<void>
  readonly handleCancel: () => Promise<void>
  readonly handleDelete: (taskId?: string) => Promise<void>
  readonly handleResetError: () => void
}

export interface PaperTaskWorkbenchLifecycleCallbacks {
  readonly mounted: () => void
  readonly pageHide: () => void
  readonly pageShow: () => void
  readonly dispose: () => void
}

export interface PaperTaskWorkbenchOptions {
  readonly transport?: PaperTaskWorkbenchTransport
  readonly registerLifecycle?: (callbacks: PaperTaskWorkbenchLifecycleCallbacks) => void
}

function registerVueLifecycle(callbacks: PaperTaskWorkbenchLifecycleCallbacks): void {
  const pageHide = (): void => callbacks.pageHide()
  const pageShow = (): void => callbacks.pageShow()
  onMounted(() => {
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('pageshow', pageShow)
    callbacks.mounted()
  })
  onUnmounted(() => {
    window.removeEventListener('pagehide', pageHide)
    window.removeEventListener('pageshow', pageShow)
    callbacks.dispose()
  })
}

function assertNever(value: never): never {
  throw new Error(`unreachable paper task result: ${String(value)}`)
}

const SOURCE_FALLBACK_MESSAGE = '无法从此链接取得可用的完整论文全文。请上传论文 PDF 继续；当前翻译/深读选择会保留。'
const PROVIDER_SETTINGS_REQUIRED_MESSAGE = '尚未配置可用的论文任务 API。请前往“论文任务 API 设置”配置提供方、接口协议和模型；如服务商要求鉴权，请填写 API 密钥。配置后返回并重新选择论文提交。'
const OBSERVATION_FAILURE_MESSAGE = '任务观察连接失败；服务端不会因此停止任务。请从任务历史重新连接，不要重复提交。'

export function usePaperTaskWorkbench(options: PaperTaskWorkbenchOptions = {}): PaperTaskWorkbench {
  const state = createPaperTaskWorkbenchState()
  const sourceUrl = ref('')
  const sourceFallbackAvailable = ref(false)
  const providerSettingsRequired = ref(false)
  const history = ref<readonly PaperTaskHistoryEntry[]>([])
  const historyLoading = ref(false)
  const historyError = ref('')
  const deletingTaskId = ref<string | null>(null)
  const observationFailed = ref(false)
  const transport = options.transport ?? createPaperTaskWorkbenchTransport()
  const registerLifecycle = options.registerLifecycle ?? registerVueLifecycle

  let activeController: AbortController | null = null
  let disposed = false
  let generation = 0
  let historyRequest = 0

  function isAbandoned(controller: AbortController): boolean {
    return disposed || controller.signal.aborted || activeController !== controller
  }

  function isStale(run: number): boolean {
    return disposed || run !== generation || state.actionPending.value === null
  }

  function isErrorPhase(): boolean {
    return state.phase.value === 'error'
  }

  async function handleRefreshHistory(): Promise<void> {
    const request = ++historyRequest
    historyLoading.value = true
    historyError.value = ''
    try {
      const result = z.array(paperTaskHistoryEntrySchema).safeParse(await transport.history())
      if (!result.success) {
        throw new Error('任务历史响应无法识别。')
      }
      if (!disposed && request === historyRequest) history.value = result.data
    } catch {
      if (!disposed && request === historyRequest) {
        historyError.value = '暂时无法读取本机保留的任务历史。'
      }
    } finally {
      if (!disposed && request === historyRequest) historyLoading.value = false
    }
  }

  async function observeTask(taskId: string, selection: PaperTaskSelection): Promise<void> {
    activeController?.abort()
    generation += 1
    state.beginRun(selection)
    state.selection.value = selection
    state.phase.value = 'running'
    observationFailed.value = false
    const controller = new AbortController()
    activeController = controller

    try {
      const request: PaperTaskObserveRequest = {
        taskId,
        selection,
        signal: controller.signal,
        onEvent: (event) => {
          if (!isAbandoned(controller)) state.adopt(event)
        },
      }
      const response = await transport.observe(request)
      if (isAbandoned(controller)) return
      if (response.kind === 'http-error') {
        observationFailed.value = true
        state.fail(response.status === 404
          ? '本机历史中没有此任务；请刷新历史并确认任务是否已删除或工作区是否已变更。'
          : `${OBSERVATION_FAILURE_MESSAGE}（HTTP ${response.status}）`)
        return
      }
      if (response.outcome.kind === 'error') {
        observationFailed.value = true
        state.fail(OBSERVATION_FAILURE_MESSAGE)
        return
      }
      state.setTerminal(response.outcome.terminal)
      state.phase.value = 'result'
    } catch {
      if (isAbandoned(controller)) return
      observationFailed.value = true
      state.fail(OBSERVATION_FAILURE_MESSAGE)
    } finally {
      if (activeController === controller) activeController = null
      if (!disposed) await handleRefreshHistory()
    }
  }

  async function handleOpenHistory(taskId: string): Promise<void> {
    if (state.actionPending.value !== null) return
    let entry = history.value.find((task) => task.taskId === taskId)
    if (entry === undefined) {
      await handleRefreshHistory()
      entry = history.value.find((task) => task.taskId === taskId)
    }
    if (entry === undefined) {
      historyError.value = '任务不在本机保留的历史记录中。'
      return
    }
    await observeTask(entry.taskId, entry.selection)
  }

  async function handleReconnect(): Promise<void> {
    const taskId = state.taskId.value
    if (taskId !== null) {
      await handleOpenHistory(taskId)
      return
    }
    await handleRefreshHistory()
  }

  function reconnectAfterPageShow(): void {
    void handleRefreshHistory()
    if (state.phase.value === 'running' && state.taskId.value !== null) {
      void handleOpenHistory(state.taskId.value)
    }
  }

  async function handleSubmit(): Promise<void> {
    const file = state.pdfFile.value
    const url = sourceUrl.value.trim()
    const selection = state.selection.value
    if ((file === null && (url === '' || sourceFallbackAvailable.value))
      || state.phase.value === 'running'
      || state.actionPending.value !== null) {
      return
    }

    const source: PaperTaskSubmitSource = file !== null
      ? { kind: 'pdf', file }
      : { kind: 'url', url }
    providerSettingsRequired.value = false
    observationFailed.value = false
    if (source.kind === 'pdf' && sourceFallbackAvailable.value) {
      sourceUrl.value = ''
    }
    state.pdfFile.value = null
    sourceFallbackAvailable.value = false
    activeController?.abort()
    activeController = null
    generation += 1
    state.beginRun(selection)
    state.phase.value = 'running'

    const controller = new AbortController()
    activeController = controller

    try {
      let response: PaperTaskSubmitResult
      try {
        const request: PaperTaskSubmitRequest = {
          source,
          selection,
          signal: controller.signal,
          onEvent: (event) => {
            if (!isAbandoned(controller)) {
              state.adopt(event)
              if (event.type === 'accepted' || event.type === 'terminal') void handleRefreshHistory()
            }
          },
        }
        response = await transport.submit(request)
      } catch (error) {
        if (isAbandoned(controller)) {
          return
        }
        if (!(error instanceof Error)) {
          throw error
        }
        if (!isErrorPhase()) {
          observationFailed.value = true
          state.fail(OBSERVATION_FAILURE_MESSAGE)
        }
        return
      }

      if (isAbandoned(controller)) {
        return
      }
      switch (response.kind) {
        case 'http-error':
          if (!isErrorPhase()) {
            if (response.status === 409) {
              providerSettingsRequired.value = true
              state.fail(PROVIDER_SETTINGS_REQUIRED_MESSAGE)
            } else if (source.kind === 'url' && (response.status === 400 || response.status === 422)) {
              sourceFallbackAvailable.value = true
              state.fail(SOURCE_FALLBACK_MESSAGE)
            } else {
              state.fail(`任务端点拒绝了请求（HTTP ${response.status}）。请检查论文来源后重新提交。`)
            }
          }
          return
        case 'stream':
          switch (response.outcome.kind) {
            case 'error':
              if (!isErrorPhase()) {
                observationFailed.value = true
                state.fail(OBSERVATION_FAILURE_MESSAGE)
              }
              return
            case 'terminal':
              if (isErrorPhase()) {
                return
              }
              state.setTerminal(response.outcome.terminal)
              state.phase.value = 'result'
              observationFailed.value = false
              return
            default:
              return assertNever(response.outcome)
          }
        default:
          return assertNever(response)
      }
    } finally {
      if (activeController === controller) {
        activeController = null
      }
      if (!disposed && !controller.signal.aborted) await handleRefreshHistory()
    }
  }

  async function handleCancel(): Promise<void> {
    const id = state.taskId.value
    const canStop = state.phase.value === 'running' || (state.phase.value === 'error' && observationFailed.value)
    if (id === null || !canStop || state.actionPending.value !== null) {
      return
    }
    const run = generation
    state.actionPending.value = 'cancel'
    let stopped = false
    try {
      const raw = await transport.cancel(id)
      if (isStale(run)) {
        return
      }
      const result = paperTaskActionResultSchema.safeParse(raw)
      if (!result.success) {
        state.fail('任务端点返回了无法识别的停止结果，请稍后重试。')
        return
      }
      if (!result.data.ok) {
        if (result.data.code === 'not-found') {
          state.fail('任务在服务端已不存在，无法停止。')
        } else {
          state.fail('停止时清理失败；已生成的样例、预览与已保存资料保留在任务工作区中。')
        }
      } else {
        stopped = true
      }
    } catch (error) {
      if (isStale(run)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      state.fail('无法停止任务。请确认开发服务器正在运行后重试。')
    } finally {
      if (state.actionPending.value === 'cancel') {
        state.actionPending.value = null
      }
    }
    if (stopped) await handleOpenHistory(id)
  }

  async function handleDelete(taskId?: string): Promise<void> {
    const id = taskId ?? state.taskId.value
    if (id === null || state.actionPending.value !== null) {
      return
    }
    const deletingCurrentTask = id === state.taskId.value
    const run = generation
    deletingTaskId.value = id
    historyError.value = ''
    state.actionPending.value = 'delete'
    if (deletingCurrentTask) activeController?.abort()
    let deleted = false
    try {
      const raw = await transport.delete(id)
      if (isStale(run)) {
        return
      }
      const result = paperTaskActionResultSchema.safeParse(raw)
      if (!result.success) {
        const message = '任务端点返回了无法识别的删除结果，请稍后重试。'
        if (deletingCurrentTask) state.fail(message)
        else historyError.value = message
        return
      }
      if (result.data.ok) {
        deleted = true
        history.value = history.value.filter((entry) => entry.taskId !== id)
        if (deletingCurrentTask) {
          state.pdfFile.value = null
          sourceUrl.value = ''
          sourceFallbackAvailable.value = false
          state.resetRun()
          state.phase.value = 'idle'
        }
      } else {
        const message = result.data.code === 'not-found'
          ? '任务在服务端已不存在，无法删除。'
          : '删除清理失败；任务记录与剩余资料仍可追踪，可重试清理。'
        if (deletingCurrentTask) state.fail(message)
        else historyError.value = message
      }
    } catch (error) {
      if (isStale(run)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      const message = '无法删除任务。请确认开发服务器正在运行后重试。'
      if (deletingCurrentTask) state.fail(message)
      else historyError.value = message
    } finally {
      if (state.actionPending.value === 'delete') {
        state.actionPending.value = null
      }
      if (deletingTaskId.value === id) deletingTaskId.value = null
    }
    if (deleted) await handleRefreshHistory()
  }

  function handleResetError(): void {
    activeController?.abort()
    activeController = null
    generation += 1
    state.actionPending.value = null
    state.pdfFile.value = null
    sourceUrl.value = ''
    sourceFallbackAvailable.value = false
    providerSettingsRequired.value = false
    observationFailed.value = false
    state.resetRun()
    state.phase.value = 'idle'
  }

  registerLifecycle({
    mounted: () => { void handleRefreshHistory() },
    pageHide: () => activeController?.abort(),
    pageShow: reconnectAfterPageShow,
    dispose: () => {
      disposed = true
      activeController?.abort()
    },
  })

  return {
    pdfFile: state.pdfFile,
    sourceUrl,
    sourceFallbackAvailable,
    providerSettingsRequired,
    history,
    historyLoading,
    historyError,
    deletingTaskId,
    observationFailed,
    selection: state.selection,
    phase: state.phase,
    taskId: state.taskId,
    actionPending: state.actionPending,
    errorMessage: state.errorMessage,
    progressLabel: state.progressLabel,
    progressPercent: state.progressPercent,
    branchStates: state.branchStates,
    terminalTitle: state.terminalTitle,
    terminalSummary: state.terminalSummary,
    previewCards: state.previewCards,
    selectionOptions: state.selectionOptions,
    branchLabel: state.branchLabel,
    stateLabel: state.stateLabel,
    handleSubmit,
    handleOpenHistory,
    handleReconnect,
    handleRefreshHistory,
    handleCancel,
    handleDelete,
    handleResetError,
  }
}
