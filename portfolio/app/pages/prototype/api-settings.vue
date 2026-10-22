<template>
  <section data-testid="prototype-api-settings" class="api-settings-page">
    <PaperSectionHeading
      stamp="原型"
      english="API SETTINGS"
      title="论文任务 API 设置"
      description="为之后启动的论文任务配置本机提供方；更改设置不会影响正在运行的任务。"
    />

    <PaperTaskApiSettings />
  </section>
</template>

<script setup lang="ts">
import PaperTaskApiSettings from '~/components/prototype/PaperTaskApiSettings.vue'
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
