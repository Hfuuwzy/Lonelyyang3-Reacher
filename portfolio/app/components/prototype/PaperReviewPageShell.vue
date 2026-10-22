<template>
  <section
    :class="['paper-review-page', { 'paper-review-page--wide': wide }]"
    data-testid="paper-review-page"
  >
    <PaperSectionHeading
      :stamp="stamp"
      :english="english"
      :title="title"
      :description="description"
    />
    <slot />
  </section>
</template>

<script setup lang="ts">
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'

interface Props {
  readonly stamp: string
  readonly english: string
  readonly title: string
  readonly description: string
  /** Reader routes opt into the wide shell so the ≤1600px guide rail can center itself. */
  readonly wide?: boolean
}

defineProps<Props>()
</script>

<style scoped>
.paper-review-page {
  display: grid;
  justify-items: center;
  gap: 48px;
  padding: 64px clamp(32px, 8vw, 96px) 160px;
  background-color: var(--paper);
  background-image: var(--paper-surface-depth);
  background-blend-mode: var(--paper-surface-blend);
  text-shadow: var(--ink-impression);
}

.paper-review-page > :deep(*) {
  width: min(100%, 920px);
}

/* Wide shells hand the full shell width to the reader grid so its symmetric
   1fr/760px/1fr tracks (and the ≥1600px sticky guide rail) can center. */
@media (width >= 1600px) {
  .paper-review-page--wide > :deep(*) {
    width: 100%;
  }
}

@media (width < 768px) {
  .paper-review-page {
    gap: 40px;
    padding: 32px 24px 128px;
  }
}
</style>