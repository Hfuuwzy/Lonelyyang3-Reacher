<template>
  <section class="paper-task-api-settings" data-testid="paper-task-api-settings" aria-labelledby="paper-task-api-settings-title">
    <header class="paper-task-api-settings__heading">
      <h2 id="paper-task-api-settings-title" class="paper-task-api-settings__title">论文任务的提供方设置</h2>
      <p class="paper-task-api-settings__intro">
        设置只供之后启动的新任务使用。正在运行的任务会继续使用启动时捕获的设置。
      </p>
    </header>

    <section class="paper-task-api-settings__status" aria-labelledby="paper-task-api-status-title">
      <h3 id="paper-task-api-status-title" class="paper-task-api-settings__section-title">当前配置</h3>
      <p v-if="phase === 'loading'" class="paper-task-api-settings__message" role="status">正在读取本机设置…</p>
      <p v-else-if="phase === 'error' && status === null" class="paper-task-api-settings__message" role="alert">
        {{ noticeText }}
        <button type="button" class="paper-task-api-settings__retry" @click="handleReload">重新读取</button>
      </p>
      <p v-else-if="status?.configured !== true" class="paper-task-api-settings__message">
        尚未应用提供方设置。完成下方字段后选择“应用设置”。
      </p>
      <dl v-else class="paper-task-api-settings__status-list">
        <div class="paper-task-api-settings__status-row">
          <dt>提供方</dt>
          <dd>{{ status.providerLabel }}</dd>
        </div>
        <div class="paper-task-api-settings__status-row">
          <dt>协议</dt>
          <dd>{{ protocolLabel }}</dd>
        </div>
        <div class="paper-task-api-settings__status-row">
          <dt>模型</dt>
          <dd>{{ status.model }}</dd>
        </div>
        <div class="paper-task-api-settings__status-row">
          <dt>Base URL</dt>
          <dd>{{ status.baseUrl }}</dd>
        </div>
        <div class="paper-task-api-settings__status-row">
          <dt>API 密钥</dt>
          <dd>{{ status.apiKeyConfigured ? '已配置' : '未配置（无需密钥）' }}</dd>
        </div>
        <div class="paper-task-api-settings__status-row">
          <dt>图像输入能力（提供方声明）</dt>
          <dd>{{ status.imageInput ? '已声明开启（未逐端点验证）' : '未开启' }}</dd>
        </div>
      </dl>
    </section>

    <form class="paper-task-api-settings__form" :aria-busy="phase === 'applying' || phase === 'clearing'" @submit.prevent="handleApply">
      <div class="paper-task-api-settings__field">
        <label for="paper-task-provider-label">提供方名称</label>
        <input
          id="paper-task-provider-label"
          v-model="form.providerLabel"
          type="text"
          maxlength="80"
          autocomplete="off"
          spellcheck="false"
          required
          :disabled="phase !== 'ready'"
        />
      </div>

      <div class="paper-task-api-settings__field">
        <label for="paper-task-provider-base-url">Base URL</label>
        <input
          id="paper-task-provider-base-url"
          v-model="form.baseUrl"
          type="url"
          inputmode="url"
          maxlength="512"
          autocomplete="off"
          spellcheck="false"
          :placeholder="protocolInfo.baseUrlPlaceholder"
          aria-describedby="paper-task-provider-base-url-note paper-task-provider-protocol-hint"
          required
          :disabled="phase !== 'ready'"
        />
        <p id="paper-task-provider-base-url-note" class="paper-task-api-settings__hint">
          填写 API 根地址；系统会按协议追加 <code>{{ protocolInfo.endpointPath }}</code>。自定义网关请按其文档填写；URL 中不得包含用户名、密码或查询参数。
        </p>
      </div>

      <div class="paper-task-api-settings__field">
        <label for="paper-task-provider-protocol">协议</label>
        <select id="paper-task-provider-protocol" v-model="form.protocol" required :disabled="phase !== 'ready'">
          <option v-for="option in protocolOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <p id="paper-task-provider-protocol-hint" class="paper-task-api-settings__hint">
          {{ protocolInfo.guidance }}
        </p>
      </div>

      <div class="paper-task-api-settings__field">
        <label for="paper-task-provider-model">模型</label>
        <input
          id="paper-task-provider-model"
          v-model="form.model"
          type="text"
          maxlength="128"
          autocomplete="off"
          spellcheck="false"
          required
          :disabled="phase !== 'ready'"
        />
      </div>

      <div class="paper-task-api-settings__field">
        <label class="paper-task-api-settings__checkbox-label" for="paper-task-provider-image-input">
          <input
            id="paper-task-provider-image-input"
            v-model="form.imageInput"
            type="checkbox"
            :disabled="phase !== 'ready'"
          />
          <span>图像输入能力（提供方声明，尚未逐端点验证）</span>
        </label>
      </div>

      <div class="paper-task-api-settings__field">
        <label for="paper-task-provider-api-key">API 密钥</label>
        <input
          id="paper-task-provider-api-key"
          v-model="form.apiKey"
          type="password"
          maxlength="4096"
          autocomplete="off"
          spellcheck="false"
          aria-describedby="paper-task-provider-api-key-note"
          :disabled="phase !== 'ready'"
        />
        <p id="paper-task-provider-api-key-note" class="paper-task-api-settings__hint">
          可留空以使用无需密钥的提供方。提交后字段立即清空，不会从服务端读取密钥。
        </p>
      </div>

      <div class="paper-task-api-settings__actions">
        <button type="submit" class="paper-task-api-settings__button" :disabled="phase !== 'ready'">
          {{ phase === 'applying' ? '正在应用…' : '应用设置' }}
        </button>
        <button
          type="button"
          class="paper-task-api-settings__button"
          :disabled="phase !== 'ready' || status?.configured !== true"
          @click="handleClear"
        >
          {{ phase === 'clearing' ? '正在清除…' : '清除设置' }}
        </button>
        <NuxtLink
          class="paper-task-api-settings__button paper-task-api-settings__button--return"
          :to="localePath(returnTo)"
        >
          返回论文任务
        </NuxtLink>
      </div>

      <p v-if="noticeText !== null && !(phase === 'error' && status === null)" class="paper-task-api-settings__message" :role="phase === 'error' ? 'alert' : 'status'">
        {{ noticeText }}
      </p>
    </form>

    <section class="paper-task-api-settings__disclosure" aria-labelledby="paper-task-api-disclosure-title">
      <h3 id="paper-task-api-disclosure-title" class="paper-task-api-settings__section-title">发送内容与费用</h3>
      <p>
        任务会把论文原文文字、任务指令、实际加载的技能与参考资料，以及受控工具结果发送至当前所选提供方配置的 API。启用图像输入后，任务会在应用边界内发送原始表格、公式与算法 PNG 裁剪及对应的原始上下文；不保证所有素材都会发送，请查阅各素材状态。
      </p>
      <p>图像输入开关只记录提供方的能力声明，尚未逐端点验证。</p>
      <p>
        密钥只经当前同源的本机服务提交，并仅保留在服务端内存；不会写入浏览器存储、任务资料、日志或版本库，服务进程重启后设置即消失。
      </p>
      <p>新任务使用启动时捕获的设置；更改或清除设置不会重新路由在运行的任务。使用提供方可能产生费用，由你承担。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePaperTaskApiSettings } from '~/composables/paper-task-api-settings'
import { PAPER_TASK_PROVIDER_PROTOCOLS, PAPER_TASK_PROVIDER_PROTOCOL_INFO } from '~/utils/paper-task-provider-contract'

const props = withDefaults(defineProps<{ readonly returnTo?: string }>(), {
  returnTo: '/prototype/paper-task',
})
const localePath = useLocalePath()

const NOTICE_COPY = {
  'invalid-settings': '请检查提供方名称、Base URL、协议与模型；API 密钥可留空。',
  'load-failed': '无法读取本机 API 设置。请重试。',
  'apply-failed': '无法应用设置。请检查字段与本机服务后重试。',
  'clear-failed': '无法清除本机设置。请确认本机服务可用后重试。',
  applied: '设置已应用，仅影响之后启动的新任务。',
  cleared: '本机设置已清除；已运行的任务不受影响。',
} as const

const {
  form,
  phase,
  notice,
  status,
  handleApply,
  handleClear,
  handleReload,
} = usePaperTaskApiSettings()

const protocolOptions = PAPER_TASK_PROVIDER_PROTOCOLS.map((value) => ({
  value,
  label: PAPER_TASK_PROVIDER_PROTOCOL_INFO[value].label,
}))

const protocolInfo = computed(() => PAPER_TASK_PROVIDER_PROTOCOL_INFO[form.protocol])

const protocolLabel = computed(() => {
  const value = status.value?.protocol
  return value === undefined ? '' : PAPER_TASK_PROVIDER_PROTOCOL_INFO[value].label
})

const noticeText = computed(() => notice.value === null ? null : NOTICE_COPY[notice.value])
const returnTo = computed(() => props.returnTo)
</script>

<style scoped src="~/assets/css/paper-task-api-settings.css"></style>
