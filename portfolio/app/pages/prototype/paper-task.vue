<template>
  <section class="paper-task" aria-labelledby="paper-task-title">
    <header class="paper-task__heading">
      <p class="paper-task__stamp" aria-hidden="true">原型</p>
      <h1 id="paper-task-title" class="paper-task__title">论文任务工作台<small>（SAMPLE 预览）</small></h1>
      <p class="paper-task__lede">
        单篇 PDF 的本地原型：选择翻译、深读或两者，任务只启动所选分支并分别呈现进度与样例。
        仅通过开发服务器提供，不属于生产站点内容。
      </p>
      <p class="paper-task__note">
        样例预览取自所上传论文的原文摘录，由本地流程提供；不调用模型，也不是真实生成的译文或深读报告。
      </p>
    </header>

    <form v-if="phase === 'idle' || phase === 'result'" class="paper-task__form" @submit.prevent="handleSubmit">
      <div class="paper-task__field">
        <label class="paper-task__label" for="paper-task-pdf">论文 PDF</label>
        <input
          id="paper-task-pdf"
          :key="taskId ?? 'pending-file'"
          class="paper-task__input"
          type="file"
          accept="application/pdf"
          :disabled="actionPending !== null"
          @change="onPdfChange"
        />
      </div>

      <fieldset class="paper-task__field" :disabled="actionPending !== null">
        <legend class="paper-task__label">任务分支</legend>
        <div class="paper-task__radios">
          <label v-for="option in selectionOptions" :key="option.value" class="paper-task__radio">
            <input v-model="selection" type="radio" name="selection" :value="option.value" />
            <span>{{ option.label }}</span>
          </label>
        </div>
      </fieldset>

      <p v-if="phase === 'result'" class="paper-task__note" role="status">
        上一任务已结束。重新提交将启动全新任务，不保留历史或自动恢复。
      </p>

      <div class="paper-task__actions">
        <button type="submit" class="paper-task__button" :disabled="pdfFile === null || actionPending !== null">
          启动任务
        </button>
      </div>
    </form>

    <div v-if="phase === 'error'" class="paper-task__error" role="alert">
      <p>{{ errorMessage }}</p>
      <div class="paper-task__actions">
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleResetError">返回</button>
        <button
          v-if="taskId !== null"
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          @click="handleDelete"
        >
          {{ actionPending === 'delete' ? '正在删除…' : '删除任务资料' }}
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
      <div class="paper-task__actions">
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleCancel">
          {{ actionPending === 'cancel' ? '正在停止…' : '停止任务' }}
        </button>
      </div>
    </div>

    <div v-if="phase === 'result'" class="paper-task__result">
      <h2 class="paper-task__result-title">{{ terminalTitle }}</h2>
      <p v-if="terminalSummary !== null" class="paper-task__status">{{ terminalSummary }}</p>
      <div class="paper-task__branch-states">
        <p v-for="branch in allBranches" :key="branch" class="paper-task__branch-state">
          <span class="paper-task__branch-name">{{ branchLabel(branch) }}</span>
          <span class="paper-task__branch-value">{{ stateLabel(branchStates[branch]) }}</span>
        </p>
      </div>
      <div class="paper-task__actions">
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleDelete">
          {{ actionPending === 'delete' ? '正在删除…' : '删除任务资料' }}
        </button>
      </div>
    </div>

    <article v-for="preview in previewCards" :key="preview.branch" class="paper-task__preview">
      <header class="paper-task__preview-heading">
        <h3>{{ branchLabel(preview.branch) }} 样例</h3>
        <p class="paper-task__preview-badge">SAMPLE · 未完成 · 未经质量检查</p>
      </header>
      <p v-for="(paragraph, index) in preview.paragraphs" :key="index" class="paper-task__preview-paragraph">
        {{ paragraph }}
      </p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { usePaperTaskWorkbench } from '~/composables/paper-task-workbench'
import { PAPER_TASK_BRANCHES } from '~/utils/paper-task-contract'

definePageMeta({ layout: 'default' })

const {
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
  selectionOptions,
  handleSubmit,
  handleCancel,
  handleDelete,
  handleResetError,
  branchLabel,
  stateLabel,
} = usePaperTaskWorkbench()

const allBranches = computed(() => PAPER_TASK_BRANCHES)

function onPdfChange(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    pdfFile.value = target.files?.[0] ?? null
  }
}
</script>

<style scoped>
.paper-task {
  max-inline-size: min(100%, 920px);
  margin-inline: auto;
  padding-block: 2.5rem 4rem;
  padding-inline: 1rem;
  color: var(--ink);
}

.paper-task__heading {
  border-block-end: 1px dotted var(--rule);
  padding-block-end: 1.25rem;
  margin-block-end: 1.5rem;
}

.paper-task__stamp {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--vermilion);
  color: var(--vermilion);
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  margin-block-end: 0.75rem;
}

.paper-task__title {
  font-family: var(--font-mincho);
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}

.paper-task__title small {
  display: block;
  font-size: 1rem;
  font-weight: 400;
  color: var(--ink-soft);
  margin-block-start: 0.25rem;
}

.paper-task__lede {
  font-family: var(--font-mincho);
  font-size: 1rem;
  line-height: 1.8;
  color: var(--ink-soft);
  margin: 0.75rem 0 0;
}

.paper-task__form,
.paper-task__error,
.paper-task__progress,
.paper-task__result {
  margin-block-start: 1rem;
}

.paper-task__field {
  border: 0;
  padding: 0;
  margin-block-end: 1.25rem;
}

.paper-task__label {
  display: block;
  font-family: var(--font-mincho);
  font-weight: 600;
  font-size: 1rem;
  margin-block-end: 0.5rem;
}

.paper-task__input {
  font-family: var(--font-mincho);
  color: var(--ink);
}

.paper-task__radios {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.paper-task__radio {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--font-mincho);
  font-size: 1rem;
  line-height: 1.6;
}

.paper-task__radio input {
  accent-color: var(--vermilion);
}

.paper-task__actions {
  display: flex;
  gap: 0.75rem;
  margin-block-start: 1rem;
}

.paper-task__button {
  font-family: var(--font-mincho);
  font-size: 1rem;
  padding: 0.45rem 1.1rem;
  background: var(--paper-warm);
  border: 1px solid var(--rule);
  color: var(--ink);
  cursor: pointer;
}

.paper-task__button:hover:not(:disabled) {
  border-color: var(--vermilion);
  color: var(--ink);
}

.paper-task__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.paper-task__note {
  font-family: var(--font-mincho);
  font-size: 0.9rem;
  color: var(--ink-soft);
  margin-block-end: 0.75rem;
}

.paper-task__status,
.paper-task__result-title {
  font-family: var(--font-mincho);
  font-size: 1.05rem;
  line-height: 1.8;
  margin: 0 0 0.75rem;
}

.paper-task__status {
  color: var(--ink);
}

.paper-task__task-id {
  font-family: var(--font-mincho);
  font-size: 0.85rem;
  color: var(--ink-soft);
  margin: 0.5rem 0 0;
}

.paper-task__branch-states {
  margin-block-start: 1rem;
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 0.75rem;
}

.paper-task__branch-state {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mincho);
  font-size: 0.95rem;
  line-height: 1.7;
  margin: 0;
  max-inline-size: 340px;
}

.paper-task__branch-value {
  color: var(--ink-soft);
}

.paper-task__error {
  font-family: var(--font-mincho);
  font-size: 1rem;
  line-height: 1.8;
  color: var(--ink);
}

.paper-task__preview {
  margin-block-start: 1.5rem;
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 1rem;
}

.paper-task__preview-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
}

.paper-task__preview-heading h3 {
  font-family: var(--font-mincho);
  font-size: 1.15rem;
  margin: 0;
}

.paper-task__preview-badge {
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  color: var(--ink);
  margin: 0;
}

.paper-task__preview-paragraph {
  font-family: var(--font-mincho);
  font-size: 1rem;
  line-height: 1.8;
  margin: 0.6rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
