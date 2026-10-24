<template>
  <section class="paper-task-settings-page">
    <PaperSectionHeading
      stamp="本机工具"
      english="PAPER TASK API SETTINGS"
      title="论文任务 API 设置"
      description="为之后启动的新任务配置本机提供方；更改设置不会影响正在运行的任务。"
    />
    <PaperTaskApiSettings return-to="/agents/paper" />
  </section>
</template>

<script setup lang="ts">
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'
import PaperTaskApiSettings from '~/components/prototype/PaperTaskApiSettings.vue'

definePageMeta({ layout: 'default' })
</script>

<style scoped>
.paper-task-settings-page {
  display: grid;
  inline-size: calc(100% + var(--site-rail-width));
  justify-items: center;
  gap: 48px;
  padding: 64px var(--site-axis-gutter) 96px;
}

@media (width < 768px) {
  .paper-task-settings-page {
    gap: 40px;
    padding: 32px var(--site-axis-gutter) 80px;
  }
}
</style>
