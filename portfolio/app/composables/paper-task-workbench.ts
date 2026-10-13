import { onMounted, onUnmounted } from 'vue'
import { paperTaskActionResultSchema } from '../utils/paper-task-contract'
import { createPaperTaskWorkbenchState, type PaperTaskWorkbenchState } from './paper-task-workbench-state'
import {
  createPaperTaskWorkbenchTransport,
  type PaperTaskSubmitRequest,
  type PaperTaskSubmitResult,
  type PaperTaskWorkbenchTransport,
} from './paper-task-workbench-transport'

export interface PaperTaskWorkbench extends PaperTaskWorkbenchState {
  readonly handleSubmit: () => Promise<void>
  readonly handleCancel: () => Promise<void>
  readonly handleDelete: () => Promise<void>
  readonly handleResetError: () => void
}

export interface PaperTaskWorkbenchLifecycleCallbacks {
  readonly pageHide: () => void
  readonly dispose: () => void
}

export interface PaperTaskWorkbenchOptions {
  readonly transport?: PaperTaskWorkbenchTransport
  readonly registerLifecycle?: (callbacks: PaperTaskWorkbenchLifecycleCallbacks) => void
}

function registerVueLifecycle(callbacks: PaperTaskWorkbenchLifecycleCallbacks): void {
  const pageHide = (): void => callbacks.pageHide()
  onMounted(() => window.addEventListener('pagehide', pageHide))
  onUnmounted(() => {
    window.removeEventListener('pagehide', pageHide)
    callbacks.dispose()
  })
}

function assertNever(value: never): never {
  throw new Error(`unreachable paper task result: ${String(value)}`)
}

export function usePaperTaskWorkbench(options: PaperTaskWorkbenchOptions = {}): PaperTaskWorkbench {
  const state = createPaperTaskWorkbenchState()
  const transport = options.transport ?? createPaperTaskWorkbenchTransport()
  const registerLifecycle = options.registerLifecycle ?? registerVueLifecycle

  let activeController: AbortController | null = null
  let disposed = false
  let generation = 0

  function isAbandoned(controller: AbortController): boolean {
    return disposed || controller.signal.aborted || activeController !== controller
  }

  function isStale(run: number): boolean {
    return disposed || run !== generation || state.actionPending.value === null
  }

  function isErrorPhase(): boolean {
    return state.phase.value === 'error'
  }

  async function handleSubmit(): Promise<void> {
    const file = state.pdfFile.value
    const selection = state.selection.value
    if (file === null || state.phase.value === 'running' || state.actionPending.value !== null) {
      return
    }

    state.pdfFile.value = null
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
          file,
          selection,
          signal: controller.signal,
          onEvent: (event) => {
            if (!isAbandoned(controller)) {
              state.adopt(event)
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
          state.fail('无法连接到本地任务端点。该工作台仅通过 npm run dev 提供，请确认开发服务器正在运行后重新提交。')
        }
        return
      }

      if (isAbandoned(controller)) {
        return
      }
      switch (response.kind) {
        case 'http-error':
          if (!isErrorPhase()) {
            state.fail(`任务端点拒绝了上传（HTTP ${response.status}）。请确认上传的是有效 PDF。`)
          }
          return
        case 'stream':
          switch (response.outcome.kind) {
            case 'error':
              if (!isErrorPhase()) {
                state.fail(response.outcome.error.message)
              }
              return
            case 'terminal':
              if (isErrorPhase()) {
                return
              }
              state.setTerminal(response.outcome.terminal)
              state.phase.value = 'result'
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
    }
  }

  async function handleCancel(): Promise<void> {
    const id = state.taskId.value
    if (id === null || state.phase.value !== 'running' || state.actionPending.value !== null) {
      return
    }
    const run = generation
    state.actionPending.value = 'cancel'
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
  }

  async function handleDelete(): Promise<void> {
    const id = state.taskId.value
    if (id === null || state.actionPending.value !== null) {
      return
    }
    const run = generation
    state.actionPending.value = 'delete'
    activeController?.abort()
    try {
      const raw = await transport.delete(id)
      if (isStale(run)) {
        return
      }
      const result = paperTaskActionResultSchema.safeParse(raw)
      if (!result.success) {
        state.fail('任务端点返回了无法识别的删除结果，请稍后重试。')
        return
      }
      if (result.data.ok) {
        state.pdfFile.value = null
        state.resetRun()
        state.phase.value = 'idle'
        return
      }
      if (result.data.code === 'not-found') {
        state.fail('任务在服务端已不存在，无法删除。')
      } else {
        state.fail('删除前清理失败，任务资料已保留；已生成的样例与文本预览不受影响。')
      }
    } catch (error) {
      if (isStale(run)) {
        return
      }
      if (!(error instanceof Error)) {
        throw error
      }
      state.fail('无法删除任务。请确认开发服务器正在运行后重试。')
    } finally {
      if (state.actionPending.value === 'delete') {
        state.actionPending.value = null
      }
    }
  }

  function handleResetError(): void {
    activeController?.abort()
    activeController = null
    generation += 1
    state.actionPending.value = null
    state.pdfFile.value = null
    state.resetRun()
    state.phase.value = 'idle'
  }

  registerLifecycle({
    pageHide: () => activeController?.abort(),
    dispose: () => {
      disposed = true
      activeController?.abort()
    },
  })

  return {
    pdfFile: state.pdfFile,
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
    handleCancel,
    handleDelete,
    handleResetError,
  }
}
