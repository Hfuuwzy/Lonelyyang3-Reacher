<template>
  <section data-testid="prototype-api-settings" class="api-settings-page">
    <PaperSectionHeading
      stamp="原型"
      english="API SETTINGS"
      title="API 设置原型"
      description="按用户自带凭证（BYOK）的单栏流式界面结构试验，不含任何真实凭证处理。"
    />

    <PrototypeNotice />

    <PrototypeFlow />
  </section>
</template>

<script setup lang="ts">
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'

definePageMeta({ layout: 'default' })
</script>

<style scoped>
.api-settings-page {
  display: grid;
  justify-items: center;
  gap: 48px;
  padding: 64px clamp(32px, 8vw, 96px) 160px;
}

@media (width < 768px) {
  .api-settings-page {
    gap: 40px;
    padding: 32px 24px 128px;
  }
}
</style>