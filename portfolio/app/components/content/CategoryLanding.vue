<template>
  <section :data-testid="`category-landing-${navKey}`" class="category-landing">
    <PaperSectionHeading
      :stamp="headingStamp"
      :english="navItem.englishLabel"
      :title="localizedTitle"
      :description="localizedDescription"
    />

    <div v-if="articleItems.length === 0" :data-testid="`category-empty-${navKey}`" class="category-landing__empty">
      <PatternDecoration variant="checker" />
      <p>{{ emptyMessage }}</p>
    </div>

    <div
      v-else
      :data-testid="`category-list-${navKey}`"
      class="category-landing__list"
      :class="`category-landing__list--${layout}`"
    >
      <ArticleRow
        v-for="item in articleItems"
        :key="item.path"
        :post="item"
        :emphasis="layout === 'feature-list'"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import PatternDecoration from '~/components/decor/PatternDecoration.vue'
import type { PortalRouteKey } from '~/data/navigation'
import { getPortalNavItem } from '~/data/navigation'
import type { ArticleListItem } from '~/utils/articles'
import ArticleRow from './ArticleRow.vue'
import PaperSectionHeading from './PaperSectionHeading.vue'

export interface CategoryLandingItem {
  readonly title: string
  readonly description: string
  readonly category: string
  readonly tags: readonly string[]
  readonly href: string
  readonly date?: string
  readonly cover?: string
}

interface Props {
  readonly navKey: PortalRouteKey
  readonly items: readonly CategoryLandingItem[]
  readonly emptyMessage: string
  readonly layout?: 'timeline' | 'feature-list'
}

const props = withDefaults(defineProps<Props>(), {
  layout: 'timeline',
})
const { locale } = useI18n()
const navItem = computed(() => getPortalNavItem(props.navKey))
const localizedTitle = computed(() => locale.value.startsWith('ja') ? navItem.value.labelJa : navItem.value.labelZh)
const localizedDescription = computed(() => locale.value.startsWith('ja') ? navItem.value.descriptionJa : navItem.value.descriptionZh)
const headingStamp = computed(() => localizedTitle.value.slice(0, 2))
const articleItems = computed<readonly ArticleListItem[]>(() => props.items.map(item => ({
  path: item.href,
  title: item.title,
  description: item.description,
  category: item.category,
  tags: item.tags,
  date: item.date,
  cover: item.cover,
})))
</script>

<style scoped src="./category-landing.css"></style>
