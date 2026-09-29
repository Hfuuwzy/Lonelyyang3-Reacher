<template>
  <form
    data-testid="paper-review-form"
    class="paper-review-form"
    @submit.prevent="emitSubmit"
    @reset="emitReset"
  >
    <div class="paper-review-form__field paper-review-form__field--file">
      <label for="paper-review-pdf">论文 PDF</label>
      <input
        id="paper-review-pdf"
        type="file"
        accept="application/pdf"
        required
        :disabled="submitting"
        @change="onPdfChange"
      />
      <p class="paper-review-form__hint">
        {{ pdfFile ? `已选择：${pdfFile.name}` : '仅支持单篇 PDF；一次提交一篇论文。' }}
      </p>
    </div>

    <div class="paper-review-form__field">
      <label for="paper-review-provider">提供方</label>
      <input
        id="paper-review-provider"
        v-model="providerLabel"
        type="text"
        autocomplete="off"
        spellcheck="false"
        required
        :disabled="submitting"
        placeholder="如 goaichat"
      />
    </div>

    <div class="paper-review-form__field paper-review-form__field--base-url">
      <label for="paper-review-base-url">Base URL</label>
      <input
        id="paper-review-base-url"
        v-model="baseUrl"
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        required
        :disabled="submitting"
        placeholder="https://llm.goaichat.top/v1"
      />
      <p class="paper-review-form__hint">按提供方文档原样复制，不做路径归一化；/v1 是否在路径中因提供方而异。</p>
    </div>

    <div class="paper-review-form__field">
      <label for="paper-review-protocol">协议</label>
      <select id="paper-review-protocol" v-model="protocol" required :disabled="submitting">
        <option v-for="option in PAPER_REVIEW_PROTOCOL_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <div class="paper-review-form__field">
      <label for="paper-review-model">模型</label>
      <input
        id="paper-review-model"
        v-model="model"
        type="text"
        autocomplete="off"
        spellcheck="false"
        required
        :disabled="submitting"
        placeholder="如 glm-5.2"
      />
    </div>

    <div class="paper-review-form__field paper-review-form__field--credential">
      <label for="paper-review-api-key">API 密钥</label>
      <input
        id="paper-review-api-key"
        v-model="apiKey"
        type="password"
        autocomplete="off"
        spellcheck="false"
        required
        :disabled="submitting"
        placeholder="仅用于本次提交，提交后立即从页面内存清除"
      />
      <p class="paper-review-form__hint">
        密钥仅随本次提交发送至上方 Base URL，提交后立即从当前页面内存清除；任何失败都不会自动重试，重新提交需要重新输入密钥。
      </p>
    </div>

    <div class="paper-review-form__actions">
      <button
        type="submit"
        class="paper-review-form__button paper-review-form__button--primary"
        :disabled="submitting"
      >
        提交审阅
      </button>
      <button type="reset" class="paper-review-form__button" :disabled="submitting">清空</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { PAPER_REVIEW_PROTOCOL_OPTIONS } from './paper-review-labels'

interface Props {
  readonly submitting: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  submit: []
  reset: []
}>()

const pdfFile = defineModel<File | null>('pdfFile', { default: null })
const providerLabel = defineModel<string>('providerLabel', { default: '' })
const baseUrl = defineModel<string>('baseUrl', { default: '' })
const protocol = defineModel<string>('protocol', { default: PAPER_REVIEW_PROTOCOL_OPTIONS[0]?.value ?? '' })
const model = defineModel<string>('model', { default: '' })
const apiKey = defineModel<string>('apiKey', { default: '' })

function onPdfChange(event: Event): void {
  const input = event.currentTarget
  if (input instanceof HTMLInputElement) {
    pdfFile.value = input.files?.[0] ?? null
  }
}

function emitSubmit(): void {
  emit('submit')
}

function emitReset(): void {
  emit('reset')
}
</script>

<style scoped>
.paper-review-form {
  display: grid;
  gap: 24px;
  padding-block-start: 28px;
  padding-block-end: 40px;
  border-block-end: 1px dotted var(--rule);
}

.paper-review-form__field {
  display: grid;
  gap: 8px;
}

.paper-review-form__field--base-url,
.paper-review-form__field--credential {
  grid-column: 1 / -1;
}

.paper-review-form__field label {
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
}

.paper-review-form__field input,
.paper-review-form__field select {
  min-block-size: 44px;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: 0;
  background: var(--paper-warm);
  color: var(--ink);
  font: inherit;
}

.paper-review-form__field input::placeholder {
  color: var(--ink-soft);
}

.paper-review-form__field input:focus-visible,
.paper-review-form__field select:focus-visible {
  border-color: var(--vermilion);
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.paper-review-form__hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.6;
}

.paper-review-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.paper-review-form__button {
  min-block-size: 44px;
  padding: 0 20px;
  border: 1px solid var(--rule);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}

.paper-review-form__button--primary {
  border-color: var(--vermilion);
  color: var(--vermilion);
}

.paper-review-form__button:hover:not(:disabled) {
  border-color: var(--vermilion);
  color: var(--vermilion);
}

.paper-review-form__button:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 2px;
}

.paper-review-form__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
