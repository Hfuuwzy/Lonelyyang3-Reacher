<template>
  <PaperTaskReader
    v-if="readerOpen && readerView !== null"
    :view="readerView"
    :preview-by-branch="readerPreviewByBranch"
    @close="readerOpen = false"
  />

  <section v-else class="paper-task" aria-labelledby="paper-task-title" data-testid="formal-paper-task-workbench">
    <header class="paper-task__heading">
      <div class="paper-task__heading-main">
        <div class="paper-task__heading-kicker">
          <p class="paper-task__stamp" aria-hidden="true">本机工具</p>
          <span>单篇论文任务</span>
        </div>
        <h1 id="paper-task-title" class="paper-task__title">论文任务工作台</h1>
        <p class="paper-task__lede">
          指定一篇论文，按需生成翻译、深读或两者；任务只运行你选择的分支。
        </p>
      </div>

      <NuxtLink class="paper-task__settings-action" :to="localePath('/agents/paper/settings')">
        <span class="paper-task__settings-mark" aria-hidden="true">API</span>
        <span class="paper-task__settings-copy">
          <strong>论文任务 API 设置</strong>
          <small>配置提供方、模型与密钥</small>
        </span>
        <span class="paper-task__settings-arrow" aria-hidden="true">↗</span>
      </NuxtLink>

      <details class="paper-task__limits">
        <summary>任务能力与限制</summary>
        <div class="paper-task__limits-copy">
          <p>工作台仅在本机开发服务中运行。任务结果会区分生成预览、需确认内容与通过门槛的完整成品。</p>
          <p>预览未必完整，也未必通过质量检查；样例、通知与问题不会被当作你的论文成果。</p>
          <p>图像输入能力仅为提供方声明，尚未逐端点验证。启用后可能发送表格、公式与算法 PNG 裁剪及对应上下文，请以各素材状态为准。</p>
        </div>
      </details>
    </header>

    <section class="paper-task__history" aria-labelledby="paper-task-history-title" data-testid="paper-task-history">
      <header class="paper-task__history-heading">
        <div>
          <p class="paper-task__form-kicker">本机保留历史</p>
          <h2 id="paper-task-history-title">任务历史</h2>
        </div>
        <button
          type="button"
          class="paper-task__button paper-task__button--quiet"
          :disabled="historyLoading"
          @click="handleRefreshHistory"
        >
          {{ historyLoading ? '正在刷新…' : '刷新历史' }}
        </button>
      </header>
      <p v-if="historyError" class="paper-task__history-error" role="status" data-testid="paper-task-history-error">{{ historyError }}</p>
      <p v-if="history.length === 0 && !historyLoading" class="paper-task__history-empty">
        尚无保留的任务记录。已保存的资料与成果会留在本机工作区；服务重启时，未完成任务会标为中断且不会自动续跑。
      </p>
      <ol v-if="history.length > 0" class="paper-task__history-list">
        <li v-for="task in history" :key="task.taskId" class="paper-task__history-item">
          <div class="paper-task__history-copy">
            <strong>{{ task.sourceTitle }}</strong>
            <time :datetime="task.createdAt">{{ formatHistoryTime(task.createdAt) }}</time>
            <span class="paper-task__history-status">{{ historyStatusLabel(task.status) }}</span>
            <span v-if="task.deletionPending" class="paper-task__history-status" role="status">删除未完成，可重试</span>
            <span class="paper-task__history-branches">
              {{ selectedHistoryBranches(task).map((branch) => `${branchLabel(branch)}：${stateLabel(task.branches[branch])}`).join('　') }}
            </span>
            <span
              v-for="fragment in task.fragments ?? []"
              :key="fragment.identity"
              class="paper-task__history-fragment"
              :data-fragment-id="fragment.identity"
              :data-fragment-source="fragment.source"
              :data-fragment-source-label="paperTaskFragmentSourceLabel(fragment.source)"
            >
              {{ branchLabel(fragment.branch) }}未完成片段 · {{ paperTaskFragmentReasonLabel(fragment.reason, 'history') }} · 质量 {{ fragmentQualityLabel(fragment.quality?.status ?? null) }} · 质量问题 {{ fragment.quality?.issues.join('；') || '无' }} · 处理选项 {{ fragment.quality?.options.join('、') || '无' }} · 来源 {{ paperTaskFragmentSourceLabel(fragment.source) }}（{{ fragment.source }}） · 任务 {{ fragment.taskId }} · {{ fragment.identity }}
            </span>
          </div>
          <button
            type="button"
            class="paper-task__button paper-task__button--quiet"
            :disabled="actionPending !== null"
            :data-testid="`paper-task-history-open-${task.taskId}`"
            @click="handleOpenHistory(task.taskId)"
          >
            {{ taskId === task.taskId && phase === 'running' ? '重新连接' : '打开任务' }}
          </button>
          <button
            type="button"
            class="paper-task__button paper-task__button--quiet"
            :disabled="actionPending !== null"
            :data-testid="`paper-task-history-delete-${task.taskId}`"
            :aria-label="`删除任务 ${task.sourceTitle}`"
            @click="requestDelete(task.taskId, task.sourceTitle)"
          >
            {{ deletingTaskId === task.taskId ? '正在删除…' : task.deletionPending ? '重试删除' : '删除' }}
          </button>
        </li>
      </ol>
    </section>

    <form
      v-if="phase === 'idle' || phase === 'result' || sourceFallbackAvailable"
      class="paper-task__form"
      @submit.prevent="handleSubmit"
    >
      <div class="paper-task__form-heading">
        <div>
          <p class="paper-task__form-kicker">步骤 01 <span>／</span> 论文来源</p>
          <h2 class="paper-task__form-title">
            {{ sourceFallbackAvailable ? '换用 PDF 继续' : '选择论文来源' }}
          </h2>
          <p class="paper-task__form-lede">
            {{ sourceFallbackAvailable ? '链接暂不可用，上传这篇论文的 PDF 即可继续。' : '粘贴受支持的 arXiv 链接或上传 PDF；只处理这一篇论文。' }}
          </p>
        </div>
        <span class="paper-task__scope">单篇任务</span>
      </div>

      <div class="paper-task__sources" :class="{ 'paper-task__sources--fallback': sourceFallbackAvailable }">
        <div v-if="!sourceFallbackAvailable" class="paper-task__field paper-task__source-panel">
          <label class="paper-task__label paper-task__source-label" for="paper-task-source-url">
            <span>论文链接</span>
            <span class="paper-task__source-chip">arXiv</span>
          </label>
          <input
            id="paper-task-source-url"
            v-model.trim="sourceUrl"
            class="paper-task__input paper-task__url-input"
            type="url"
            inputmode="url"
            autocomplete="url"
            placeholder="https://arxiv.org/abs/2404.05961"
            :disabled="actionPending !== null || pdfFile !== null"
          />
          <p class="paper-task__source-hint">粘贴受支持的 arXiv 论文页面链接</p>
        </div>

        <div class="paper-task__field paper-task__source-panel paper-task__source-panel--upload">
          <label class="paper-task__label paper-task__source-label" for="paper-task-pdf">
            <span>{{ sourceFallbackAvailable ? '上传论文 PDF' : '本地 PDF' }}</span>
            <span class="paper-task__source-chip">PDF</span>
          </label>
          <input
            id="paper-task-pdf"
            :key="taskId ?? 'pending-file'"
            class="paper-task__input paper-task__file-input"
            type="file"
            accept="application/pdf"
            :disabled="actionPending !== null || (!sourceFallbackAvailable && sourceUrl.trim() !== '')"
            @change="onPdfChange"
          />
          <p v-if="sourceFallbackAvailable" class="paper-task__fallback-note" role="status">{{ errorMessage }}</p>
          <p v-else class="paper-task__source-hint">链接无法读取时，可上传这篇论文的 PDF 继续</p>
        </div>
      </div>

      <fieldset class="paper-task__field paper-task__selection" :disabled="actionPending !== null">
        <legend class="paper-task__label paper-task__selection-label">选择生成内容 <span>按需选择分支</span></legend>
        <div class="paper-task__radios">
          <label
            v-for="option in selectionOptions"
            :key="option.value"
            class="paper-task__radio"
            :class="{ 'paper-task__radio--selected': selection === option.value }"
          >
            <input v-model="selection" type="radio" name="selection" :value="option.value" />
            <span>{{ option.label }}</span>
          </label>
        </div>
      </fieldset>

      <p v-if="phase === 'result'" class="paper-task__note" role="status">
        当前任务已结束。返回阅读时会保留此任务上下文；再次提交会启动一项新任务。
      </p>

      <div class="paper-task__actions">
        <button
          type="submit"
          class="paper-task__button paper-task__button--primary"
          :disabled="(pdfFile === null && (sourceUrl.trim() === '' || sourceFallbackAvailable)) || actionPending !== null"
        >
          {{ sourceFallbackAvailable ? '使用 PDF 继续' : '启动任务' }}
        </button>
        <button v-if="sourceFallbackAvailable" type="button" class="paper-task__button paper-task__button--quiet" @click="handleResetError">
          返回链接输入
        </button>
      </div>
    </form>

    <div v-if="phase === 'error' && !sourceFallbackAvailable" class="paper-task__error" role="alert">
      <p>{{ errorMessage }}</p>
      <div class="paper-task__actions">
        <NuxtLink
          v-if="providerSettingsRequired"
          class="paper-task__button paper-task__button--primary"
          :to="localePath('/agents/paper/settings')"
        >
          前往配置 API 设置
        </NuxtLink>
        <button
          v-if="observationFailed"
          type="button"
          class="paper-task__button paper-task__button--primary"
          :disabled="actionPending !== null"
          @click="taskId === null ? handleRefreshHistory() : handleReconnect()"
        >
          {{ taskId === null ? '刷新任务历史' : '重新连接任务' }}
        </button>
        <button
          v-if="observationFailed && taskId !== null"
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          @click="handleCancel"
        >
          {{ actionPending === 'cancel' ? '正在停止…' : '明确停止任务' }}
        </button>
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleResetError">
          {{ providerSettingsRequired ? '返回重新选择论文' : '返回' }}
        </button>
        <button
          v-if="taskId !== null"
          type="button"
          class="paper-task__button"
          v-show="!observationFailed"
          :disabled="actionPending !== null"
          data-testid="paper-task-delete"
          @click="requestDelete(taskId)"
        >
          {{ deletingTaskId === taskId ? '正在删除…' : '删除任务资料' }}
        </button>
      </div>
    </div>

    <div v-if="phase === 'running'" class="paper-task__progress" aria-live="polite">
      <p class="paper-task__status">{{ progressLabel }}</p>
      <progress :value="progressPercent" max="100" :aria-label="progressLabel">{{ progressPercent }}%</progress>
      <p class="paper-task__task-id" aria-hidden="true">任务 {{ taskId }}</p>
      <div class="paper-task__branch-states">
        <p v-for="branch in allBranches" :key="branch" class="paper-task__branch-state">
          <span class="paper-task__branch-name">{{ branchLabel(branch) }}</span>
          <span class="paper-task__branch-value">{{ stateLabel(branchStates[branch]) }}</span>
        </p>
      </div>
      <p v-if="actionPending === 'cancel'" class="paper-task__status" role="status">
        已发送停止请求，正在等待任务清理与终止状态。
      </p>
      <p v-if="actionPending === 'delete'" class="paper-task__status" role="status">
        已确认删除；正在请求停止并等待任务结算与运行时清理完成。
      </p>
      <div class="paper-task__actions">
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleCancel">
          {{ actionPending === 'cancel' ? '正在停止…' : '停止任务' }}
        </button>
        <button
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          data-testid="paper-task-delete"
          @click="requestDelete(taskId)"
        >
          {{ deletingTaskId === taskId ? '正在删除…' : '删除任务资料' }}
        </button>
      </div>
    </div>

    <div v-if="phase === 'result'" class="paper-task__result">
      <h2 class="paper-task__result-title">{{ displayTerminalTitle }}</h2>
      <p v-if="terminalSummary !== null" class="paper-task__status">{{ terminalSummary }}</p>
      <div class="paper-task__branch-states">
        <p v-for="branch in allBranches" :key="branch" class="paper-task__branch-state">
          <span class="paper-task__branch-name">{{ branchLabel(branch) }}</span>
          <span class="paper-task__branch-value">{{ stateLabel(branchStates[branch]) }}</span>
        </p>
      </div>
      <p v-if="reader.state.value.kind === 'loading'" class="paper-task__status" role="status">
        正在读取此任务的可读成果…
      </p>
      <p v-else-if="readerView !== null && readerView.documents.length === 0" class="paper-task__status" role="status">
        任务已结束，但目前没有可读的 Markdown 成果。未完成片段、失败分支或样例不会被当作完整阅读稿。
      </p>
      <div v-else-if="reader.state.value.kind === 'error'" class="paper-task__error" role="alert">
        <p>无法读取此任务的真实成果；不会显示其他任务或示例内容。请重试读取，或检查上方分支状态。</p>
        <button type="button" class="paper-task__button" @click="reader.refresh()">重试读取成果</button>
      </div>
      <div class="paper-task__actions">
        <button
          v-if="readerView !== null && readerView.documents.length > 0"
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          @click="readerOpen = true"
        >
          进入专注阅读
        </button>
        <button
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          data-testid="paper-task-delete"
          @click="requestDelete(taskId)"
        >
          {{ deletingTaskId === taskId ? '正在删除…' : '删除任务资料' }}
        </button>
      </div>
    </div>

    <PaperTaskQualityPanel v-if="qualityEntries.length > 0" :entries="qualityEntries" />

    <PaperTaskSourceMaterials
      v-if="taskId !== null"
      :task-id="taskId"
      :ready="phase === 'result' || phase === 'error'"
    />
  </section>

  <dialog
    ref="deleteDialog"
    class="paper-task__delete-dialog"
    aria-modal="true"
    aria-labelledby="paper-task-delete-title"
    aria-describedby="paper-task-delete-description"
    data-testid="paper-task-delete-dialog"
    @cancel="handleDeleteDialogCancel"
    @close="handleDeleteDialogClose"
    @click.self="closeDeleteDialog"
  >
    <div class="paper-task__delete-content">
      <p class="paper-task__delete-kicker">不可撤销操作</p>
      <h2 id="paper-task-delete-title">删除任务资料？</h2>
      <p v-if="pendingDelete?.sourceTitle" class="paper-task__delete-subject">
        <span>任务来源</span>
        <strong>{{ pendingDelete.sourceTitle }}</strong>
      </p>
      <div id="paper-task-delete-description" class="paper-task__delete-copy">
        <p>将删除本机工作区中的原文、共享资料、素材与成果。此操作不可撤销。</p>
        <p>若任务仍在运行，将先停止并等待运行时清理完成。其他位置的下载副本不会删除。</p>
      </div>
      <div class="paper-task__delete-actions">
        <button
          type="button"
          class="paper-task__button paper-task__delete-cancel"
          data-testid="paper-task-delete-cancel"
          autofocus
          @click="closeDeleteDialog"
        >
          取消
        </button>
        <button
          type="button"
          class="paper-task__button paper-task__delete-confirm"
          data-testid="paper-task-delete-confirm"
          :disabled="actionPending !== null || deletionConfirmationPending"
          @click="confirmDelete"
        >
          {{ deletionConfirmationPending ? '正在删除…' : '确认删除' }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import PaperTaskReader from '~/components/agents/PaperTaskReader.vue'
import PaperTaskQualityPanel from '~/components/agents/PaperTaskQualityPanel.vue'
import PaperTaskSourceMaterials from '~/components/prototype/PaperTaskSourceMaterials.vue'
import { usePaperTaskReader } from '~/composables/paper-task-reader'
import { usePaperTaskWorkbench } from '~/composables/paper-task-workbench'
import {
  PAPER_TASK_BRANCHES,
  type PaperTaskBranch,
  type PaperTaskDesignation,
  type PaperTaskHistoryEntry,
  type PaperTaskHistoryStatus,
} from '~/utils/paper-task-contract'
import { paperTaskFragmentReasonLabel, paperTaskFragmentSourceLabel } from '~/utils/paper-task-fragment-labels'
import type { PaperTaskQualityEntry } from '~/utils/paper-task-quality-summary'

const {
  pdfFile,
  sourceUrl,
  sourceFallbackAvailable,
  providerSettingsRequired,
  history,
  historyLoading,
  historyError,
  deletingTaskId,
  observationFailed,
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
  selectionOptions,
  handleSubmit,
  handleOpenHistory,
  handleReconnect,
  handleRefreshHistory,
  handleCancel,
  handleDelete,
  handleResetError,
  branchLabel,
  stateLabel,
} = usePaperTaskWorkbench()

const localePath = useLocalePath()
const allBranches = computed(() => PAPER_TASK_BRANCHES)
const reader = usePaperTaskReader(taskId, computed(() => phase.value === 'result'))
const readerView = computed(() => reader.state.value.kind === 'loaded' ? reader.state.value.view : null)
const readerPreviewByBranch = computed(() => Object.fromEntries(previewCards.value.map((preview) => [preview.branch, {
  headingLabel: preview.headingLabel,
  badge: preview.badge,
  designation: preview.designation,
  paragraphs: preview.paragraphs,
  issues: preview.issues,
  options: preview.options,
}])) as Partial<Record<PaperTaskBranch, {
  readonly headingLabel: string
  readonly badge: string
  readonly designation: PaperTaskDesignation
  readonly paragraphs: readonly string[]
  readonly issues: readonly string[]
  readonly options: readonly string[]
}>>)
const qualityEntries = computed<readonly PaperTaskQualityEntry[]>(() => previewCards.value.map(preview => ({
  branch: preview.branch,
  branchLabel: branchLabel(preview.branch),
  headingLabel: preview.headingLabel,
  badge: preview.badge,
  designation: preview.designation,
  issues: preview.issues,
  options: preview.options,
})))
const readerOpen = ref(false)
const readerAutoOpened = ref(false)
const deleteDialog = ref<HTMLDialogElement | null>(null)
const pendingDelete = shallowRef<{ readonly taskId: string; readonly sourceTitle: string | null } | null>(null)
const deleteDialogOpener = ref<HTMLElement | null>(null)
const deletionConfirmationPending = ref(false)
let deleteWasConfirmed = false

const displayTerminalTitle = computed(() => {
  const current = readerView.value
  if (phase.value !== 'result' || current === null || current.documents.length === 0) {
    return terminalTitle.value
  }

  const hasFailedBranch = PAPER_TASK_BRANCHES.some(branch => branchStates.value[branch] === 'failed')
  return hasFailedBranch ? '部分分支失败 · 仍有可读成果' : terminalTitle.value
})

watch(taskId, () => {
  readerAutoOpened.value = false
  readerOpen.value = false
})

watch(
  () => reader.state.value,
  (state) => {
    if (state.kind === 'loaded' && state.view.documents.length > 0 && !readerAutoOpened.value) {
      readerAutoOpened.value = true
      readerOpen.value = true
    }
  },
)

function onPdfChange(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    pdfFile.value = target.files?.[0] ?? null
    if (pdfFile.value !== null) sourceUrl.value = ''
  }
}

function selectedHistoryBranches(task: PaperTaskHistoryEntry) {
  return PAPER_TASK_BRANCHES.filter((branch) => task.branches[branch] !== 'not-selected')
}

function historyStatusLabel(status: PaperTaskHistoryStatus): string {
  switch (status) {
    case 'running': return '运行中'
    case 'success': return '成功'
    case 'fail': return '失败'
    case 'stopped': return '已停止'
    case 'interrupted': return '服务中断'
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function fragmentQualityLabel(status: 'preview' | 'needs-confirmation' | 'complete' | null): string {
  if (status === 'complete') return '预览声明完整（非最终稿）'
  if (status === 'needs-confirmation') return '需确认'
  if (status === 'preview') return '未完成预览'
  return '不可用'
}

function formatHistoryTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN')
}

function requestDelete(id: string | null, sourceTitle?: string): void {
  const dialog = deleteDialog.value
  if (id === null || dialog === null || pendingDelete.value !== null
    || actionPending.value !== null || deletingTaskId.value !== null) return

  const target = {
    taskId: id,
    sourceTitle: sourceTitle ?? history.value.find((task) => task.taskId === id)?.sourceTitle ?? null,
  }
  pendingDelete.value = target
  deleteDialogOpener.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void nextTick(() => {
    if (pendingDelete.value === target && !dialog.open) dialog.showModal()
  })
}

function closeDeleteDialog(): void {
  if (deleteDialog.value?.open) deleteDialog.value.close()
}

function handleDeleteDialogCancel(event: Event): void {
  event.preventDefault()
  closeDeleteDialog()
}

function handleDeleteDialogClose(): void {
  const shouldRestoreFocus = !deleteWasConfirmed
  deleteWasConfirmed = false
  pendingDelete.value = null

  const opener = deleteDialogOpener.value
  deleteDialogOpener.value = null
  if (shouldRestoreFocus && opener?.isConnected) {
    void nextTick(() => {
      if (opener.isConnected) opener.focus()
    })
  }
}

function confirmDelete(): void {
  const target = pendingDelete.value
  if (target === null || deletionConfirmationPending.value || actionPending.value !== null
    || !deleteDialog.value?.open) return

  deletionConfirmationPending.value = true
  deleteWasConfirmed = true
  closeDeleteDialog()
  void handleDelete(target.taskId).finally(() => {
    deletionConfirmationPending.value = false
  })
}
</script>

<style scoped src="~/assets/css/paper-task.css"></style>

<style scoped>
.paper-task__history-fragment {
  max-inline-size: 100%;
  color: var(--ink-soft);
  font-size: 0.8rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.paper-task__history {
  margin-block: 2rem;
  padding: 1.25rem 0;
  border-block: 1px solid var(--line-soft, currentColor);
}

.paper-task__history-heading,
.paper-task__history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.paper-task__history-heading h2 {
  margin: 0.25rem 0 0;
}

.paper-task__history-list {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.paper-task__history-item {
  padding-block: 0.75rem;
  border-top: 1px solid var(--line-soft, currentColor);
}

.paper-task__history-copy {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.paper-task__history-copy > * {
  overflow-wrap: anywhere;
}

.paper-task__history-status,
.paper-task__history-branches,
.paper-task__history-empty,
.paper-task__history-error {
  color: var(--ink-soft);
  font-size: 0.9rem;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .paper-task__history-item {
    align-items: flex-start;
  }
}
</style>
