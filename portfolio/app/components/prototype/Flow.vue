<template>
  <div data-testid="variant-flow" class="prototype-flow">
    <PrototypeSetupGuide />

    <section class="prototype-flow__section">
      <PrototypeProviderForm
        form-id="openai"
        name="OpenAI 兼容端点"
        english="OPENAI-COMPATIBLE"
        note="适用于 OpenAI 及各类 OpenAI 兼容代理或网关。"
        :base-url-placeholder="GUIDE.openaiCompatible.baseUrl"
        :model-placeholder="GUIDE.openaiCompatible.models[0]"
        :protocols="OPENAI_PROTOCOLS"
      />
    </section>

    <section class="prototype-flow__section">
      <PrototypeProviderForm
        form-id="anthropic"
        name="Anthropic 兼容端点"
        english="ANTHROPIC-COMPATIBLE"
        note="适用于 Anthropic API 及 Anthropic 兼容端点。"
        :base-url-placeholder="GUIDE.anthropicCompatible.baseUrl"
        :model-placeholder="GUIDE.anthropicCompatible.models[0]"
        :protocols="ANTHROPIC_PROTOCOLS"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ANTHROPIC_PROTOCOLS, OPENAI_PROTOCOLS } from './ProviderForm.vue'
import { GATEWAY_GUIDE_SETUP } from './api-settings-config'

const GUIDE = GATEWAY_GUIDE_SETUP
</script>

<style scoped>
.prototype-flow {
  display: grid;
  max-inline-size: 860px;
}

.prototype-flow__section {
  padding-block: 40px;
  border-block-end: 1px dotted var(--rule);
}

.prototype-flow__section:last-child {
  border-block-end: 0;
}
</style>