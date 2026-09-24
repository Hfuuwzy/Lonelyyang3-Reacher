<template>
  <article
    class="article-row"
    :class="{ 'article-row--emphasis': emphasis }"
    :data-testid="`article-row-${slug}`"
  >
    <img
      v-if="emphasis && post.cover"
      class="article-row__cover"
      :src="post.cover"
      :alt="post.title ?? ''"
      width="640"
      height="360"
      loading="lazy"
    >
    <div class="article-row__body">
      <div class="article-row__meta">
        <time v-if="displayDate" :datetime="dateTime">{{ displayDate }}</time>
        <span v-if="post.category">{{ post.category }}</span>
      </div>
      <h3 class="article-row__title">
        <NuxtLink class="article-row__link" :to="localizedPath" :prefetch="prefetch">
          {{ post.title ?? post.path }}
        </NuxtLink>
      </h3>
      <p v-if="post.description" class="article-row__description">{{ post.description }}</p>
      <ul v-if="post.tags?.length" class="article-row__tags" aria-label="Tags">
        <li v-for="tag in post.tags" :key="tag" class="article-row__tag">{{ tag }}</li>
      </ul>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { ArticleListItem } from '~/utils/articles'
import { formatDisplayDate } from '~/utils/articles'
import { localizedPathFromCanonical, slugFromBlogPath } from '~/utils/paths'

interface Props {
  readonly post: ArticleListItem
  readonly emphasis?: boolean
  readonly prefetch?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  prefetch: true,
})
const localePath = useLocalePath()
const { locale } = useI18n()
const slug = computed(() => slugFromBlogPath(props.post.path))
const localizedPath = computed(() => localizedPathFromCanonical(props.post.path, localePath))
const displayLocale = computed<'zh' | 'ja'>(() => locale.value.startsWith('ja') ? 'ja' : 'zh')
const displayDate = computed(() => formatDisplayDate(props.post.date, displayLocale.value))
const dateTime = computed(() => {
  if (props.post.date instanceof Date) {
    return props.post.date.toISOString()
  }

  return props.post.date ?? ''
})
</script>

<style scoped src="./article-row.css"></style>
