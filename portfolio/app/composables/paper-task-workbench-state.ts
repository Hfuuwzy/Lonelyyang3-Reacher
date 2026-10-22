import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  getSelectedBranches,
  initialBranchStates,
  type PaperTaskBranch,
  type PaperTaskBranches,
  type PaperTaskDesignation,
  type PaperTaskEvent,
  type PaperTaskOutcome,
  type PaperTaskQuality,
  type PaperTaskQualityOption,
  type PaperTaskSelection,
  type PaperTaskStage,
  type PaperTaskState,
} from '../utils/paper-task-contract'

export interface PaperTaskSelectionOption {
  readonly value: PaperTaskSelection
  readonly label: string
}

export interface PaperTaskPreviewCard {
  readonly branch: PaperTaskBranch
  readonly designation: PaperTaskDesignation
  readonly headingLabel: string
  readonly badge: string
  readonly paragraphs: readonly string[]
  readonly quality: PaperTaskQuality | null
  readonly issues: readonly string[]
  readonly options: readonly string[]
}

export interface PaperTaskWorkbenchState {
  readonly pdfFile: Ref<File | null>
  readonly selection: Ref<PaperTaskSelection>
  readonly phase: Ref<'idle' | 'running' | 'result' | 'error'>
  readonly taskId: Ref<string | null>
  readonly actionPending: Ref<'cancel' | 'delete' | null>
  readonly errorMessage: Ref<string>
  readonly progressLabel: ComputedRef<string>
  readonly progressPercent: ComputedRef<number>
  readonly branchStates: ComputedRef<PaperTaskBranches>
  readonly terminalTitle: ComputedRef<string>
  readonly terminalSummary: ComputedRef<string | null>
  readonly previewCards: ComputedRef<readonly PaperTaskPreviewCard[]>
  readonly selectionOptions: readonly PaperTaskSelectionOption[]
  readonly branchLabel: (branch: PaperTaskBranch) => string
  readonly stateLabel: (state: PaperTaskState) => string
}

export interface PaperTaskWorkbenchStateController extends PaperTaskWorkbenchState {
  readonly adopt: (event: PaperTaskEvent) => void
  readonly beginRun: (selection: PaperTaskSelection) => void
  readonly resetRun: () => void
  readonly setTerminal: (event: PaperTaskEvent) => void
  readonly fail: (message: string) => void
}

interface PaperTaskProgress {
  readonly stage: PaperTaskStage
  readonly branch: PaperTaskBranch | null
  readonly completed: number
  readonly total: number
}

const SELECTION_OPTIONS = [
  { value: 'translation', label: '翻译' },
  { value: 'deep-reading', label: '深读' },
  { value: 'both', label: '翻译与深读' },
] as const satisfies readonly PaperTaskSelectionOption[]

const BRANCH_LABELS: Record<PaperTaskBranch, string> = {
  translation: '翻译',
  'deep-reading': '深读',
}

const PREVIEW_PRESENTATION: Record<PaperTaskDesignation, { readonly headingLabel: string; readonly badge: string }> = {
  sample: { headingLabel: '样例', badge: 'SAMPLE' },
  'generated-preview': {
    headingLabel: '文本预览',
    badge: '文本预览 · 未完成 · 未经质量检查',
  },
}

const STAGE_LABELS: Record<PaperTaskStage, string> = {
  preparing: '准备',
  generating: '生成',
  cleaning: '清理',
}

const STATE_LABELS: Record<PaperTaskState, string> = {
  'not-selected': '未选择',
  pending: '等待中',
  running: '进行中',
  'sample-ready': '样例就绪',
  'preview-ready': '文本预览就绪',
  'needs-confirmation': '需确认',
  complete: '完整成品',
  failed: '失败',
  cancelled: '已取消',
}

const QUALITY_OPTION_LABELS: Record<PaperTaskQualityOption, string> = {
  'keep-readable': '保留当前可读内容',
  'inspect-source': '核对原文材料',
  regenerate: '重新生成',
}

const OUTCOME_TITLES: Record<PaperTaskOutcome, string> = {
  succeeded: '样例任务结束',
  failed: '任务失败',
  cancelled: '任务已停止',
  disconnected: '连接中断',
}

const OUTCOME_SUMMARIES: Record<PaperTaskOutcome, string> = {
  succeeded: '所选分支均有可读预览。样例或文本预览均未完成且未经质量检查，不代表成品、内容完整或质量通过。',
  failed: '部分分支失败；未选择的分支不受影响。其余分支的预览与已保存资料保留在任务工作区中。失败原因见开发服务器控制台的 [paper-task] 日志或任务资料的 runtime-error.json。',
  cancelled: '任务已停止，未完成的分支标为已取消。已收到的样例、预览与已保存资料保留在任务工作区中。',
  disconnected: '连接中断，未完成的分支标为已取消。已收到的样例、预览与已保存资料保留在任务工作区中。',
}

function previewQualityPresentation(
  preview: Extract<PaperTaskEvent, { type: 'preview' }>,
): { readonly headingLabel: string; readonly badge: string } {
  if (preview.quality === undefined) return PREVIEW_PRESENTATION[preview.designation]
  switch (preview.quality.status) {
    case 'complete':
      return { headingLabel: '完整成品', badge: '完整成品 · 内容审阅与结构检查通过' }
    case 'needs-confirmation':
      return { headingLabel: '需确认', badge: '需确认 · 保留可读内容' }
    case 'preview':
      return PREVIEW_PRESENTATION[preview.designation]
    default: {
      const exhaustive: never = preview.quality.status
      throw new Error(`unreachable paper task quality state: ${String(exhaustive)}`)
    }
  }
}

export function createPaperTaskWorkbenchState(): PaperTaskWorkbenchStateController {
  const pdfFile = ref<File | null>(null)
  const selection = ref<PaperTaskSelection>('both')
  const phase = ref<'idle' | 'running' | 'result' | 'error'>('idle')
  const taskId = ref<string | null>(null)
  const actionPending = ref<'cancel' | 'delete' | null>(null)
  const errorMessage = ref('')
  const progress = ref<PaperTaskProgress | null>(null)
  const terminal = ref<PaperTaskEvent | null>(null)
  const activeSelection = ref<PaperTaskSelection | null>(null)
  const cumulativeBranchStates = ref<PaperTaskBranches>(initialBranchStates(selection.value))
  const previews = ref<Partial<Record<PaperTaskBranch, Extract<PaperTaskEvent, { type: 'preview' }>>>>({})

  const progressLabel = computed(() => {
    const current = progress.value
    if (current === null) {
      return '正在准备任务…'
    }
    const part = `${current.completed}/${current.total}`
    return current.branch === null
      ? `${STAGE_LABELS[current.stage]} ${part}`
      : `${STAGE_LABELS[current.stage]} · ${BRANCH_LABELS[current.branch]} ${part}`
  })

  const progressPercent = computed(() => {
    const current = progress.value
    if (current === null) {
      return 0
    }
    return Math.min(100, Math.round((current.completed / current.total) * 100))
  })

  const branchStates = computed<PaperTaskBranches>(() => {
    const current = terminal.value
    return current !== null && current.type === 'terminal'
      ? current.branches
      : cumulativeBranchStates.value
  })

  const terminalTitle = computed(() => {
    const current = terminal.value
    if (current === null || current.type !== 'terminal') {
      return ''
    }
    switch (current.outcome) {
      case 'succeeded': {
        const branches = [current.branches.translation, current.branches['deep-reading']]
        if (branches.includes('complete')) return '完整成品已就绪'
        if (branches.includes('needs-confirmation')) return '成果需确认'
        return branches.includes('preview-ready') ? '文本预览任务结束' : OUTCOME_TITLES.succeeded
      }
      case 'failed':
      case 'cancelled':
      case 'disconnected':
        return OUTCOME_TITLES[current.outcome]
      default: {
        const exhaustive: never = current.outcome
        throw new Error(`unreachable paper task outcome: ${String(exhaustive)}`)
      }
    }
  })

  const terminalSummary = computed(() => {
    const current = terminal.value
    if (current === null || current.type !== 'terminal') {
      return null
    }
    const cleanupNote = current.cleanup === 'clean'
      ? ''
      : ' 运行时清理失败；仅影响临时运行目录，已保存的资料、预览与工作区不受影响。'
    const branches = [current.branches.translation, current.branches['deep-reading']]
    if (current.outcome === 'succeeded' && branches.includes('complete')) {
      return '所选分支中已有通过内容审阅与独立结构检查的完整成品；其他分支请按各自状态查看。' + cleanupNote
    }
    if (current.outcome === 'succeeded' && branches.includes('needs-confirmation')) {
      return '所选分支保留了可读成果，但仍有需要判断的事项；请查看问题说明，系统不会自动标为完整。' + cleanupNote
    }
    return OUTCOME_SUMMARIES[current.outcome] + cleanupNote
  })

  const previewCards = computed<readonly PaperTaskPreviewCard[]>(() => {
    const selected = activeSelection.value ?? selection.value
    return getSelectedBranches(selected).flatMap((branch) => {
      const preview = previews.value[branch]
      if (preview === undefined) {
        return []
      }
      const presentation = previewQualityPresentation(preview)
      return [{
        branch,
        designation: preview.designation,
        headingLabel: presentation.headingLabel,
        badge: presentation.badge,
        paragraphs: preview.paragraphs,
        quality: preview.quality ?? null,
        issues: preview.quality?.issues ?? [],
        options: (preview.quality?.options ?? []).map((option) => QUALITY_OPTION_LABELS[option]),
      }]
    })
  })

  function adopt(event: PaperTaskEvent): void {
    switch (event.type) {
      case 'accepted':
        taskId.value = event.taskId
        return
      case 'progress': {
        progress.value = { stage: event.stage, branch: event.branch, completed: event.completed, total: event.total }
        const currentState = event.branch === null ? null : cumulativeBranchStates.value[event.branch]
        if (event.branch !== null && currentState !== 'sample-ready' && currentState !== 'preview-ready'
          && currentState !== 'needs-confirmation' && currentState !== 'complete') {
          cumulativeBranchStates.value = { ...cumulativeBranchStates.value, [event.branch]: 'running' }
        }
        return
      }
      case 'preview':
        previews.value = { ...previews.value, [event.branch]: event }
        cumulativeBranchStates.value = {
          ...cumulativeBranchStates.value,
          [event.branch]: event.quality === undefined
            ? event.designation === 'sample' ? 'sample-ready' : 'preview-ready'
            : event.quality.status === 'complete'
              ? 'complete'
              : event.quality.status === 'needs-confirmation' ? 'needs-confirmation' : 'preview-ready',
        }
        return
      case 'terminal':
        return
      default: {
        const exhaustive: never = event
        throw new Error(`unreachable paper task event: ${String(exhaustive)}`)
      }
    }
  }

  function resetRun(): void {
    taskId.value = null
    progress.value = null
    terminal.value = null
    activeSelection.value = null
    cumulativeBranchStates.value = initialBranchStates(selection.value)
    previews.value = {}
    errorMessage.value = ''
  }

  function beginRun(selected: PaperTaskSelection): void {
    resetRun()
    activeSelection.value = selected
    cumulativeBranchStates.value = initialBranchStates(selected)
  }

  function setTerminal(event: PaperTaskEvent): void {
    terminal.value = event
  }

  function fail(message: string): void {
    errorMessage.value = message
    phase.value = 'error'
  }

  function branchLabel(branch: PaperTaskBranch): string {
    return BRANCH_LABELS[branch]
  }

  function stateLabel(state: PaperTaskState): string {
    return STATE_LABELS[state]
  }

  return {
    pdfFile,
    selection,
    phase,
    taskId,
    actionPending,
    errorMessage,
    progressLabel,
    progressPercent,
    branchStates,
    terminalTitle,
    terminalSummary,
    previewCards,
    selectionOptions: SELECTION_OPTIONS,
    branchLabel,
    stateLabel,
    adopt,
    beginRun,
    resetRun,
    setTerminal,
    fail,
  }
}
