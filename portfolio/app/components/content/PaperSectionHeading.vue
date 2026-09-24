<template>
  <header class="paper-section-heading">
    <span class="paper-section-heading__stamp">{{ stamp }}</span>
    <div class="paper-section-heading__copy">
      <p class="paper-section-heading__english">{{ english }}</p>
      <h2 class="paper-section-heading__title">{{ title }}</h2>
      <p v-if="description" class="paper-section-heading__description">{{ description }}</p>
    </div>
  </header>
</template>

<script setup lang="ts">
interface Props {
  readonly stamp: string
  readonly english: string
  readonly title: string
  readonly description?: string
}

defineProps<Props>()
</script>

<style scoped src="./paper-section-heading.css"></style>
