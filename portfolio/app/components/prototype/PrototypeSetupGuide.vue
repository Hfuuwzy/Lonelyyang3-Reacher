<template>
  <section
    data-testid="prototype-setup-guide"
    class="prototype-setup-guide"
    aria-labelledby="prototype-setup-guide-title"
  >
    <p class="prototype-setup-guide__eyebrow">PROVIDER SETUP</p>
    <h3 id="prototype-setup-guide-title" class="prototype-setup-guide__title">API 接入要点</h3>

    <div class="prototype-setup-guide__body">
      <p class="prototype-setup-guide__item">
        <strong>协议</strong>：OpenAI 兼容端点选择「OpenAI Chat Completions」，Anthropic 兼容端点选择「Anthropic Messages」——每种提供方对应一种协议。
      </p>
      <p class="prototype-setup-guide__item">
        <strong>Base URL 与模型 ID</strong>：从你的提供方控制台或文档复制、原样填写，不做路径归一化；<code>/v1</code> 是否出现在路径中因提供方而异，不能按惯例推断。
      </p>
      <p class="prototype-setup-guide__item">
        <strong>指南示例</strong>：该接入指南中，OpenAI 兼容 Chat Completions 的 Base URL 为
        <code>{{ openaiBaseUrl }}</code>，模型如 <code>{{ openaiModels.join('、') }}</code>；
        Anthropic 兼容 Messages 为 <code>{{ anthropicBaseUrl }}</code>（不带 <code>/v1</code>），
        模型如 <code>{{ anthropicModels.join('、') }}</code>。其他提供方的 Base URL 各不相同，请照抄你自己提供方文档里的地址。
      </p>
      <p class="prototype-setup-guide__item">
        <strong>密钥与费用</strong>：API 密钥由你自己提供并保管，调用费用由你直接向提供方支付。实际费率与计费规则由提供方制定，启用前请先查阅提供方当前的定价。
      </p>
      <p class="prototype-setup-guide__item">
        <strong>数据去向</strong>：配置后，请求可能把相关内容发送给你配置的提供方。本原型为纯演示——不发起任何请求、不保存任何密钥，请勿输入真实密钥。
      </p>
    </div>

    <p class="prototype-setup-guide__source">示例来源：key.goaichat.top/guide/ 网关接入指南，不代表其他提供方的路径惯例。</p>
  </section>
</template>

<script setup lang="ts">
import { GATEWAY_GUIDE_SETUP } from './api-settings-config'

const openaiBaseUrl = GATEWAY_GUIDE_SETUP.openaiCompatible.baseUrl
const openaiModels = GATEWAY_GUIDE_SETUP.openaiCompatible.models
const anthropicBaseUrl = GATEWAY_GUIDE_SETUP.anthropicCompatible.baseUrl
const anthropicModels = GATEWAY_GUIDE_SETUP.anthropicCompatible.models
</script>

<style scoped>
.prototype-setup-guide {
  display: grid;
  gap: 14px;
  padding-block-end: 28px;
  border-block-end: 1px dotted var(--rule);
}

.prototype-setup-guide__eyebrow {
  margin: 0;
  color: var(--vermilion);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

.prototype-setup-guide__title {
  margin: 0;
  color: var(--ink);
  font: 600 clamp(22px, 3vw, 32px)/1.4 var(--font-mincho);
}

.prototype-setup-guide__body {
  display: grid;
  gap: 10px;
}

.prototype-setup-guide__item {
  margin: 0;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.8;
}

.prototype-setup-guide__item strong {
  color: var(--ink);
  font-weight: 600;
}

.prototype-setup-guide__item code {
  color: var(--ink);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-size: 0.9em;
}

.prototype-setup-guide__source {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.7;
}
</style>