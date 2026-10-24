<template>
  <article v-if="page" data-testid="blog-detail" class="blog-detail" :lang="displayLocale">
    <div class="blog-detail__grid">
      <ArticleReadingSidebar
        class="blog-detail__aside"
        :toc="page.body?.toc?.links ?? []"
        :tags="page.tags ?? []"
        :recent-articles="recentArticles"
        :locale="displayLocale"
      />

      <div id="blog-reading-content" class="blog-detail__body">
        <header class="blog-detail__header">
          <div data-testid="blog-detail-meta" class="blog-detail__meta">
            <time v-if="displayDate" :datetime="dateTime">{{ displayDate }}</time>
            <span v-if="page.category">{{ page.category }}</span>
          </div>
          <h1 data-testid="blog-detail-title" class="blog-detail__title">{{ page.title }}</h1>
          <p v-if="page.description" class="blog-detail__description">{{ page.description }}</p>
          <img
            v-if="page.cover"
            data-testid="blog-detail-cover"
            class="blog-detail__cover"
            :src="page.cover"
            :alt="page.title ?? ''"
            width="960"
            height="540"
          >
        </header>

        <ArticleProse :value="page" :components="articleComponents" />

        <nav class="blog-detail__navigation" aria-label="Article navigation">
          <NuxtLink
            v-if="previousArticle"
            data-testid="article-prev-link"
            class="blog-detail__surrounding blog-detail__surrounding--previous"
            :to="localePath(previousArticle.path)"
          >
            <span>{{ previousLabel }}</span>
            <strong>{{ previousArticle.title }}</strong>
          </NuxtLink>
          <NuxtLink
            v-if="nextArticle"
            data-testid="article-next-link"
            class="blog-detail__surrounding blog-detail__surrounding--next"
            :to="localePath(nextArticle.path)"
          >
            <span>{{ nextLabel }}</span>
            <strong>{{ nextArticle.title }}</strong>
          </NuxtLink>
          <NuxtLink data-testid="article-back-link" class="blog-detail__back" :to="localePath('/blog')">
            {{ backLabel }}
          </NuxtLink>
        </nav>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import ArticleReadingSidebar from '~/components/content/ArticleReadingSidebar.vue'
import ArticleProse from '~/components/content/ArticleProse.vue'
import ArticleTable from '~/components/content/ArticleTable.vue'
import { formatDisplayDate } from '~/utils/articles'
import { canonicalContentPathFromRoute } from '~/utils/paths'

definePageMeta({ layout: 'default' })

const route = useRoute()
const localePath = useLocalePath()
const { locale } = useI18n()
const contentPath = computed(() => canonicalContentPathFromRoute(route.path))
const articleDataKey = computed(() => `blog-article:${contentPath.value}`)

const { data: articleData } = await useAsyncData(articleDataKey, async () => {
  const page = await queryCollection('blog').path(contentPath.value).first()
  if (!page) {
    return { page: null, surroundings: null, recentArticles: [] }
  }

  const [surroundings, articles] = await Promise.all([
    queryCollectionItemSurroundings('blog', contentPath.value, {
      fields: ['title', 'description', 'path'],
    }),
    queryCollection('blog').order('date', 'DESC').all(),
  ])
  const recentArticles = articles
    .filter(article => article.path !== contentPath.value)
    .slice(0, 2)

  return { page, surroundings, recentArticles }
})

if (!articleData.value?.page) {
  setResponseStatus(404, 'Article not found')
  throw createError({ statusCode: 404, statusMessage: 'Article not found' })
}

const page = computed(() => articleData.value?.page)
const previousArticle = computed(() => articleData.value?.surroundings?.[0] ?? null)
const nextArticle = computed(() => articleData.value?.surroundings?.[1] ?? null)
const recentArticles = computed(() => articleData.value?.recentArticles ?? [])
const articleComponents = { table: ArticleTable }
const displayLocale = computed<'zh' | 'ja'>(() => locale.value.startsWith('ja') ? 'ja' : 'zh')
const displayDate = computed(() => formatDisplayDate(page.value?.date, displayLocale.value))
const dateTime = computed(() => page.value?.date instanceof Date ? page.value.date.toISOString() : page.value?.date ?? '')
const previousLabel = computed(() => locale.value.startsWith('ja') ? '前の記事' : '上一篇')
const nextLabel = computed(() => locale.value.startsWith('ja') ? '次の記事' : '下一篇')
const backLabel = computed(() => locale.value.startsWith('ja') ? 'ブログ一覧へ' : '返回博客')

useSeoMeta({
  title: () => page.value?.title,
  description: () => page.value?.description,
})
</script>

<style scoped src="./blog-detail.css"></style>
<style src="./blog-detail-typography.css"></style>
