<template>
  <button
    type="button"
    data-testid="theme-toggle"
    class="theme-toggle"
    :title="accessibleName"
    :aria-label="accessibleName"
    @click="toggleTheme"
  >
    <svg v-if="isDark" class="theme-toggle__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
    <svg v-else class="theme-toggle__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
    <span>{{ t('drawer.theme') }}</span>
  </button>
</template>

<script setup lang="ts">
const isDark = ref(false)
const { t } = useI18n()
const accessibleName = computed(() => isDark.value ? 'Switch to light mode' : 'Switch to dark mode')

function toggleTheme(): void {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark')
})
</script>

<style scoped>
.theme-toggle {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
}

.theme-toggle:hover {
  background: var(--sakura);
  color: var(--vermilion);
}

.theme-toggle:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.theme-toggle__icon {
  inline-size: 20px;
  block-size: 20px;
  flex: 0 0 20px;
}
</style>
