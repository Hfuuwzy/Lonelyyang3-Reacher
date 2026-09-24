<template>
  <svg
    class="paper-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-width="1.75"
    :data-testid="testId"
    aria-hidden="true"
  >
    <template v-if="open">
      <path d="M5 5 19 19" />
      <path d="M19 5 5 19" />
    </template>
    <template v-else>
      <path d="M7 4v16" />
      <path d="M12 4v16" />
      <path d="M17 4v16" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  readonly open: boolean
  readonly testId?: string
}>()
</script>

<style scoped>
.paper-icon {
  display: block;
  inline-size: 24px;
  block-size: 24px;
}
</style>
