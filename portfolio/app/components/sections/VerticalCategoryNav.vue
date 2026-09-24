<template>
  <nav class="vertical-category-nav" :class="`vertical-category-nav--${density}`" aria-label="Content categories">
    <NuxtLink
      v-for="category in categories"
      :key="category.key"
      :to="localePath(category.path)"
      class="vertical-category-nav__link"
    >
      <span class="vertical-category-nav__label">{{ localizedLabel(category) }}</span>
      <span class="vertical-category-nav__english">{{ category.englishLabel }}</span>
    </NuxtLink>
  </nav>
</template>

<script setup lang="ts">
import type { PortalCategory } from '~/data/navigation'

interface Props {
  readonly categories: readonly PortalCategory[]
  readonly density?: 'hero' | 'drawer'
}

withDefaults(defineProps<Props>(), {
  density: 'hero',
})

const localePath = useLocalePath()
const { locale } = useI18n()

function localizedLabel(category: PortalCategory): string {
  return locale.value.startsWith('ja') ? category.labelJa : category.labelZh
}
</script>

<style scoped src="./vertical-category-nav.css"></style>
