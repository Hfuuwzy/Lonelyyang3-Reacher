<template>
  <section class="paper-task" aria-labelledby="paper-task-title">
    <header class="paper-task__heading">
      <p class="paper-task__stamp" aria-hidden="true">原型</p>
      <h1 id="paper-task-title" class="paper-task__title">论文任务工作台</h1>
      <p class="paper-task__lede">
        单篇 PDF 选择翻译、深读或两者，任务只启动所选分支。此原型固定使用 DSH 0.1.7-rc.2。
        仅通过开发服务器提供，不属于生产站点内容。
      </p>
      <p class="paper-task__note">
        卡片会区分 SAMPLE 与生成文本预览。预览未完成且未经质量检查，不代表翻译准确、内容完整，也不能据此认定模型已完整理解图像或通过验收。
      </p>
      <p class="paper-task__note">
        提供方图像输入能力仅为声明，尚未逐端点验证。启用后，任务会在应用边界内发送原始表格、公式与算法 PNG 裁剪及对应的原始上下文；不保证所有素材都会发送，请查阅各素材状态。
      </p>
      <NuxtLink class="paper-task__settings-link" :to="localePath('/prototype/api-settings')">
        论文任务 API 设置
      </NuxtLink>
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

    <PaperTaskTranslationPreview
      v-if="taskId !== null"
      :task-id="taskId"
      :ready="translationReady"
      :quality-status="translationQualityStatus"
      @loaded="translationMasterTaskId = taskId"
    />

    <article v-for="preview in visiblePreviewCards" :key="preview.branch" class="paper-task__preview">
      <header class="paper-task__preview-heading">
        <h3>{{ branchLabel(preview.branch) }} {{ preview.headingLabel }}</h3>
        <p class="paper-task__preview-badge" :data-designation="preview.designation">{{ preview.badge }}</p>
      </header>
      <p v-for="(paragraph, index) in preview.paragraphs" :key="index" class="paper-task__preview-paragraph">
        {{ paragraph }}
      </p>
      <ul v-if="preview.issues.length > 0" class="paper-task__preview-issues" aria-label="需确认事项">
        <li v-for="(issue, index) in preview.issues" :key="index">{{ issue }}</li>
      </ul>
      <p v-if="preview.options.length > 0" class="paper-task__preview-options">
        处理选择：{{ preview.options.join('、') }}
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
import PaperTaskTranslationPreview from '~/components/prototype/PaperTaskTranslationPreview.vue'
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

const localePath = useLocalePath()
const allBranches = computed(() => PAPER_TASK_BRANCHES)
const translationMasterTaskId = ref<string | null>(null)
const translationReady = computed(() => phase.value === 'result'
  && (branchStates.value.translation === 'preview-ready'
    || branchStates.value.translation === 'needs-confirmation'
    || branchStates.value.translation === 'complete'))
const translationQualityStatus = computed<'preview' | 'needs-confirmation' | 'complete'>(() => {
  if (branchStates.value.translation === 'complete') return 'complete'
  if (branchStates.value.translation === 'needs-confirmation') return 'needs-confirmation'
  return 'preview'
})
const visiblePreviewCards = computed(() => previewCards.value.filter((preview) =>
  !(preview.branch === 'translation' && translationMasterTaskId.value === taskId.value),
))

watch(taskId, () => {
  translationMasterTaskId.value = null
})

function onPdfChange(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    pdfFile.value = target.files?.[0] ?? null
  }
}
</script>

<style scoped src="~/assets/css/paper-task.css"></style>

<style scoped>
.paper-task__settings-link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  margin-block-start: 0.5rem;
  color: var(--ink);
  font-family: var(--font-mincho);
  text-decoration: underline;
  text-decoration-color: var(--rule);
  text-underline-offset: 0.2em;
}

.paper-task__settings-link:hover {
  text-decoration-color: var(--ink);
}

.paper-task__settings-link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.paper-task__preview-issues,
.paper-task__preview-options {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.9rem;
  line-height: 1.7;
}

.paper-task__preview-issues {
  padding-inline-start: 1.1rem;
}
</style>
