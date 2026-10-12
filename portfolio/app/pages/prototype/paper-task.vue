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

    <PaperTaskSourceMaterials
      v-if="taskId !== null"
      :task-id="taskId"
      :ready="phase === 'result' || phase === 'error'"
    />
  </section>
</template>

<script setup lang="ts">
import PaperTaskSourceMaterials from '~/components/prototype/PaperTaskSourceMaterials.vue'
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

<style scoped src="~/assets/css/paper-task.css"></style>
