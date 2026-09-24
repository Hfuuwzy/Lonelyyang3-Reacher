<template>
  <Transition name="fade">
    <button
      v-show="show"
      data-testid="scroll-to-top"
      class="scroll-to-top"
      type="button"
      title="返回顶部"
      aria-label="返回顶部"
      @click="scrollToTop"
    >
      <svg class="scroll-to-top__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  </Transition>
</template>

<script setup lang="ts">
const show = ref(false)

function handleScroll(): void {
  show.value = window.scrollY > 300
}

function scrollToTop(): void {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  window.scrollTo({ top: 0, behavior })
}

onMounted(() => {
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
.scroll-to-top {
  position: fixed;
  z-index: 55;
  inset-block-end: 24px;
  inset-inline-end: calc(var(--rail-width) + 24px);
  display: grid;
  inline-size: 48px;
  block-size: 48px;
  place-items: center;
  border: 2px solid var(--vermilion);
  border-radius: 0;
  background: var(--paper-warm);
  box-shadow: none;
  color: var(--vermilion);
  cursor: pointer;
  transition: opacity 220ms ease, transform 220ms ease;
}

.scroll-to-top:hover {
  transform: translateY(-4px);
}

.scroll-to-top:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.scroll-to-top__icon {
  inline-size: 20px;
  block-size: 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 220ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (width < 1024px) {
  .scroll-to-top {
    inset-inline-end: calc(var(--rail-width-tablet) + 24px);
  }
}

@media (width < 768px) {
  .scroll-to-top {
    inset-inline-end: calc(var(--rail-width-mobile) + 16px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .scroll-to-top,
  .fade-enter-active,
  .fade-leave-active {
    transition-duration: 1ms;
  }
}
</style>
