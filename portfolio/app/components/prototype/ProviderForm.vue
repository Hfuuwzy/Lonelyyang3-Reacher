<template>
  <section class="prototype-provider-form">
    <header class="prototype-provider-form__heading">
      <p class="prototype-provider-form__english">{{ english }}</p>
      <h3 class="prototype-provider-form__title">{{ name }}</h3>
      <p v-if="note" class="prototype-provider-form__note">{{ note }}</p>
    </header>

    <div class="prototype-provider-form__fields">
      <div class="prototype-provider-form__field prototype-provider-form__field--base-url">
        <label :for="`${formId}-base-url`">Base URL</label>
        <input
          :id="`${formId}-base-url`"
          v-model="baseUrl"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          :placeholder="baseUrlPlaceholder"
        />
        <p class="prototype-provider-form__hint">按提供方文档原样复制，不做路径归一化；/v1 是否在路径中因提供方而异。</p>
      </div>

      <div class="prototype-provider-form__field">
        <label :for="`${formId}-protocol`">协议</label>
        <select :id="`${formId}-protocol`" v-model="protocol">
          <option v-for="option in protocols" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>

      <div class="prototype-provider-form__field">
        <label :for="`${formId}-model`">模型</label>
        <input
          :id="`${formId}-model`"
          v-model="model"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="modelPlaceholder"
        />
      </div>

      <div class="prototype-provider-form__field prototype-provider-form__field--credential">
        <label :for="`${formId}-credential`">API 密钥</label>
        <input
          :id="`${formId}-credential`"
          v-model="apiKey"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="请勿输入真实密钥"
        />
        <p class="prototype-provider-form__hint">密码样式输入；本原型不会发送、不会持久保存，密钥只停留在当前页面内存中，刷新即消失。请勿输入真实密钥。</p>
      </div>
    </div>

    <div class="prototype-provider-form__actions">
      <button type="button" class="prototype-provider-form__button" @click="testConnection">测试连接</button>
      <button type="button" class="prototype-provider-form__button prototype-provider-form__button--primary" @click="save">保存</button>
      <button type="button" class="prototype-provider-form__button" @click="reset">清空</button>
    </div>

    <p v-if="message" class="prototype-provider-form__message" role="status">{{ message }}</p>
  </section>
</template>

<script lang="ts">
import { API_PROTOCOLS, type ApiProtocol } from './api-settings-config'

export type { ApiProtocol }

export interface ProtocolOption {
  readonly value: ApiProtocol
  readonly label: string
}

export const OPENAI_PROTOCOLS: readonly ProtocolOption[] = [
  { value: API_PROTOCOLS.openaiCompletions, label: 'OpenAI Chat Completions' },
]

export const ANTHROPIC_PROTOCOLS: readonly ProtocolOption[] = [
  { value: API_PROTOCOLS.anthropicMessages, label: 'Anthropic Messages' },
]
</script>

<script setup lang="ts">
interface Props {
  readonly formId: string
  readonly name: string
  readonly english: string
  readonly note?: string
  readonly baseUrlPlaceholder: string
  readonly modelPlaceholder: string
  readonly protocols: readonly ProtocolOption[]
}

const props = defineProps<Props>()

const baseUrl = ref('')
const protocol = ref<ApiProtocol>(props.protocols[0]?.value ?? 'openai-completions')
const model = ref('')
const apiKey = ref('')
const message = ref<string | null>(null)

function testConnection(): void {
  message.value = '开发原型：未发起任何网络请求。'
}

function save(): void {
  message.value = '开发原型：凭证不会被保存或发送。'
}

function reset(): void {
  baseUrl.value = ''
  protocol.value = props.protocols[0]?.value ?? 'openai-completions'
  model.value = ''
  apiKey.value = ''
  message.value = '已清空当前输入。'
}
</script>

<style scoped src="./provider-form.css"></style>