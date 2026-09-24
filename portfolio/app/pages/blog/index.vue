<template>
  <section data-testid="category-landing-blog" class="blog-index">
    <PaperSectionHeading
      stamp="博"
      :english="navItem.englishLabel"
      :title="localizedTitle"
      :description="localizedDescription"
    />

    <nav class="blog-index__filters" aria-label="Article categories">
      <NuxtLink
        v-for="category in categoryOptions"
        :key="category.value"
        class="blog-index__filter"
        :class="{ 'blog-index__filter--active': selectedCategory === category.value }"
        :data-testid="`blog-category-${category.testId}`"
        :aria-current="selectedCategory === category.value ? 'page' : undefined"
        :to="category.value === ALL_CATEGORIES
          ? localePath('/blog')
          : { path: localePath('/blog'), query: { category: category.value } }"
      >
        {{ category.label }}
      </NuxtLink>
    </nav>

    <div data-testid="category-list-blog" class="blog-index__timeline">
      <ArticleRow v-for="post in filteredPosts" :key="post.path" :post="post" />
    </div>
  </section>
</template>

<script setup lang="ts">
import ArticleRow from '~/components/content/ArticleRow.vue'
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'
import { getPortalNavItem } from '~/data/navigation'
import type { ArticleListItem } from '~/utils/articles'
import { sortArticlesByDateDesc } from '~/utils/articles'

definePageMeta({ layout: 'default' })

const ALL_CATEGORIES = 'all'
const route = useRoute()
const localePath = useLocalePath()
const { locale } = useI18n()
const navItem = getPortalNavItem('blog')
const selectedCategory = computed(() => typeof route.query.category === 'string' ? route.query.category : ALL_CATEGORIES)
const localizedTitle = computed(() => locale.value.startsWith('ja') ? navItem.labelJa : navItem.labelZh)
const localizedDescription = computed(() => locale.value.startsWith('ja') ? navItem.descriptionJa : navItem.descriptionZh)

const { data: posts } = await useAsyncData('blog-posts', () =>
  queryCollection('blog')
    .order('date', 'DESC')
    .all()
)

const sortedPosts = computed<readonly ArticleListItem[]>(() => sortArticlesByDateDesc(
  (posts.value ?? []).map(post => ({
    path: post.path,
    title: post.title,
    description: post.description,
    date: post.date,
    category: post.category,
    tags: post.tags,
    cover: post.cover,
  })),
))

const categoryOptions = computed(() => [
  {
    value: ALL_CATEGORIES,
    label: locale.value.startsWith('ja') ? 'すべて' : '全部',
    testId: ALL_CATEGORIES,
  },
  ...Array.from(new Set(sortedPosts.value.flatMap(post => post.category ? [post.category] : []))).map(category => ({
    value: category,
    label: category,
    testId: category.toLocaleLowerCase(),
  })),
])

const filteredPosts = computed<readonly ArticleListItem[]>(() => selectedCategory.value === ALL_CATEGORIES
  ? sortedPosts.value
  : sortedPosts.value.filter(post => post.category === selectedCategory.value))
</script>

<style scoped src="./blog-index.css"></style>
