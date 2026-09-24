<template>
  <div data-testid="locale-switch" class="locale-switch" role="group" :aria-label="t('drawer.language')">
    <NuxtLink
      v-for="link in localeLinks"
      :key="link.key"
      :to="link.path"
      class="locale-switch__link"
      :class="{ 'locale-switch__link--current': locale === link.code }"
      :aria-current="locale === link.code ? 'page' : undefined"
    >
      <span>{{ link.label }}</span>
      <span v-if="locale === link.code" class="locale-switch__current">
        <svg class="locale-switch__check" fill="none" stroke="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m3 8 3 3 7-7" />
        </svg>
        {{ t('drawer.currentLocale') }}
      </span>
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const localeOptions = [
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
] as const

const { locale, t } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const route = useRoute()
const localeLinks = computed(() => localeOptions.map(option => ({
  ...option,
  key: `${route.fullPath}:${option.code}`,
  path: switchLocalePath(option.code),
})))
</script>

<style scoped>
.locale-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.locale-switch__link {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--rule);
  color: var(--ink-soft);
  text-decoration: none;
}

.locale-switch__link:hover {
  background: var(--sakura);
  color: var(--ink);
}

.locale-switch__link:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.locale-switch__link--current {
  border-color: var(--vermilion);
  color: var(--ink);
  font-weight: 700;
}

.locale-switch__current {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.08em;
}

.locale-switch__check {
  inline-size: 14px;
  block-size: 14px;
  flex: 0 0 14px;
}
</style>
