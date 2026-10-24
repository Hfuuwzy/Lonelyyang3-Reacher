<template>
  <div class="paper-task-route">
    <PaperTaskWorkbench />
  </div>
</template>

<script setup lang="ts">
import PaperTaskWorkbench from '~/components/agents/PaperTaskWorkbench.vue'

definePageMeta({ layout: 'default' })
</script>

<style scoped>
.paper-task-route {
  inline-size: calc(100% + var(--site-rail-width));
  min-inline-size: 0;
}
</style>
