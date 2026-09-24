<template>
  <section data-testid="information-feed" class="chronological-feed">
    <h2 v-if="title" class="chronological-feed__title">{{ title }}</h2>

    <template v-if="variant === 'home'">
      <div class="chronological-feed__desktop">
        <div data-testid="feed-column-primary">
          <ArticleRow v-for="post in feed.primary" :key="post.path" :post="post" :prefetch="false" />
        </div>
        <div data-testid="feed-column-secondary">
          <ArticleRow v-for="post in feed.secondary" :key="post.path" :post="post" :prefetch="false" />
        </div>
      </div>
      <div data-testid="feed-single-column" class="chronological-feed__mobile">
        <ArticleRow v-for="post in feed.combined" :key="post.path" :post="post" :prefetch="false" />
      </div>
    </template>

    <div v-else data-testid="feed-single-column" class="chronological-feed__single">
      <ArticleRow v-for="post in posts" :key="post.path" :post="post" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ArticleListItem } from '~/utils/articles'
import { splitEvenOddFeed } from '~/utils/articles'

interface Props {
  readonly posts: readonly ArticleListItem[]
  readonly variant: 'home' | 'single'
  readonly title?: string
}

const props = defineProps<Props>()
const feed = computed(() => splitEvenOddFeed(props.posts))
</script>

<style scoped src="./chronological-feed.css"></style>
