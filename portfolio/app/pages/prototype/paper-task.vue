<template>
  <PaperTaskReader
    v-if="readerOpen && readerView !== null"
    :view="readerView"
    @close="readerOpen = false"
  />

  <section v-else class="paper-task" aria-labelledby="paper-task-title">
    <header class="paper-task__heading">
      <div class="paper-task__heading-main">
        <div class="paper-task__heading-kicker">
          <p class="paper-task__stamp" aria-hidden="true">原型</p>
          <span>本地论文任务</span>
        </div>
        <h1 id="paper-task-title" class="paper-task__title">论文任务工作台</h1>
        <p class="paper-task__lede">
          指定一篇论文，按需生成翻译、深读或两者；任务只运行你选择的分支。
        </p>
      </div>

      <NuxtLink class="paper-task__settings-action" :to="localePath('/prototype/api-settings')">
        <span class="paper-task__settings-mark" aria-hidden="true">API</span>
        <span class="paper-task__settings-copy">
          <strong>论文任务 API 设置</strong>
          <small>配置提供方、模型与密钥</small>
        </span>
        <span class="paper-task__settings-arrow" aria-hidden="true">↗</span>
      </NuxtLink>

      <details class="paper-task__limits">
        <summary>原型能力与限制</summary>
        <div class="paper-task__limits-copy">
          <p>此原型固定使用 DSH 0.1.7-rc.2，仅通过开发服务器提供，不属于生产站点内容。</p>
          <p>结果会区分 SAMPLE 与生成文本预览；预览未完成且未经质量检查，不代表翻译准确、内容完整或通过验收。</p>
          <p>图像输入能力仅为提供方声明，尚未逐端点验证。启用后可能发送原始表格、公式与算法 PNG 裁剪及对应上下文；请以素材状态为准。</p>
        </div>
      </details>
    </header>

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
            {{ sourceFallbackAvailable ? '链接暂不可用，上传这篇论文的 PDF 即可继续。' : '粘贴 arXiv 链接或上传 PDF；只处理这一篇论文。' }}
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
          <p class="paper-task__source-hint">粘贴 arXiv 论文页面链接</p>
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
          <p v-else class="paper-task__source-hint">链接无法读取时，也可以从 PDF 继续</p>
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
        上一任务已结束。重新提交将启动全新任务，不保留历史或自动恢复。
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
          :to="localePath('/prototype/api-settings')"
        >
          前往配置 API 设置
        </NuxtLink>
        <button type="button" class="paper-task__button" :disabled="actionPending !== null" @click="handleResetError">
          {{ providerSettingsRequired ? '返回重新选择论文' : '返回' }}
        </button>
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
        <button
          v-if="readerView !== null && readerView.documents.length > 0"
          type="button"
          class="paper-task__button"
          :disabled="actionPending !== null"
          @click="readerOpen = true"
        >
          进入专注阅读
        </button>
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
import PaperTaskReader from '~/components/agents/PaperTaskReader.vue'
import PaperTaskSourceMaterials from '~/components/prototype/PaperTaskSourceMaterials.vue'
import PaperTaskTranslationPreview from '~/components/prototype/PaperTaskTranslationPreview.vue'
import { usePaperTaskReader } from '~/composables/paper-task-reader'
import { usePaperTaskWorkbench } from '~/composables/paper-task-workbench'
import { PAPER_TASK_BRANCHES } from '~/utils/paper-task-contract'

definePageMeta({ layout: false })

const {
  pdfFile,
  sourceUrl,
  sourceFallbackAvailable,
  providerSettingsRequired,
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
const reader = usePaperTaskReader(taskId, computed(() => phase.value === 'result'))
const readerView = computed(() => reader.state.value.kind === 'loaded' ? reader.state.value.view : null)
const readerOpen = ref(false)
const readerAutoOpened = ref(false)
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
</script>

<style scoped src="~/assets/css/paper-task.css"></style>

<style scoped>
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
