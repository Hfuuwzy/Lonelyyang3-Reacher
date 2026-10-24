<template>
  <aside class="article-reading-sidebar" :aria-label="labels.sidebar">
    <div class="article-reading-sidebar__intro">
      <section class="article-reading-sidebar__card article-reading-sidebar__profile" :aria-label="labels.author">
        <p class="article-reading-sidebar__eyebrow">MYSELF / WORLD</p>
        <h2>Lonelyyang3</h2>
        <p>{{ labels.bio }}</p>
        <a href="https://github.com/Hfuuwzy" target="_blank" rel="noopener noreferrer">
          GitHub ↗
        </a>
      </section>

      <section class="article-reading-sidebar__card article-reading-sidebar__announcement">
        <h3>{{ labels.announcement }}</h3>
        <p>{{ labels.announcementText }}</p>
      </section>
    </div>

    <div class="article-reading-sidebar__sticky">
      <nav v-if="toc.length" class="article-reading-sidebar__card article-reading-sidebar__contents" :aria-label="labels.contents">
        <p class="article-reading-sidebar__eyebrow">
          <span>{{ labels.contentsHeading }}</span>
          <span :aria-label="labels.progress">{{ progress }}%</span>
        </p>
        <ArticleTocBranch :links="toc" :active-id="activeId" />
      </nav>

      <section
        v-if="tags.length"
        class="article-reading-sidebar__card article-reading-sidebar__tags"
        data-testid="article-tags"
        :aria-label="labels.tags"
      >
        <h3>{{ labels.tags }}</h3>
        <ul>
          <li v-for="tag in tags" :key="tag">{{ tag }}</li>
        </ul>
      </section>

      <section
        v-if="visibleRecentArticles.length"
        class="article-reading-sidebar__card article-reading-sidebar__recent"
        :aria-label="labels.recent"
      >
        <h3>{{ labels.recent }}</h3>
        <ul>
          <li v-for="article in visibleRecentArticles" :key="article.path">
            <NuxtLink :to="localePath(article.path)">{{ article.title }}</NuxtLink>
            <time v-if="article.date" :datetime="String(article.date)">
              {{ formatDisplayDate(article.date, locale) }}
            </time>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArticleTocBranch from './ArticleTocBranch.vue'
import type { ArticleTocLink } from '~/utils/article-toc'
import { flattenArticleToc } from '~/utils/article-toc'
import type { ArticleListItem } from '~/utils/articles'
import { formatDisplayDate } from '~/utils/articles'

const props = withDefaults(defineProps<{
  readonly toc: readonly ArticleTocLink[]
  readonly tags?: readonly string[]
  readonly recentArticles?: readonly ArticleListItem[]
  readonly locale?: 'zh' | 'ja'
}>(), {
  tags: () => [],
  recentArticles: () => [],
  locale: 'zh',
})

const localePath = useLocalePath()
const labels = computed(() => props.locale === 'ja'
  ? {
      sidebar: '記事の補助情報',
      author: '著者',
      bio: '大学院での生活と、AIとの探究。',
      announcement: 'お知らせ',
      announcementText: '学びと研究、ツールの実践を記録しています。ゆっくりお読みください。',
      contents: 'この記事の目次',
      contentsHeading: 'CONTENTS / 目次',
      progress: '読書の進捗',
      tags: 'この記事のタグ',
      recent: '最近の記事',
    }
  : {
      sidebar: '文章辅助信息',
      author: '作者',
      bio: '研究生生活，与 AI 一起探索。',
      announcement: '公告',
      announcementText: '记录学习、研究与工具实践。欢迎交流，也欢迎慢慢读。',
      contents: '本文目录',
      contentsHeading: 'CONTENTS / 目录',
      progress: '阅读进度',
      tags: '本文标签',
      recent: '最近文章',
    })
const visibleRecentArticles = computed(() => props.recentArticles.slice(0, 2))
const flattenedToc = computed(() => flattenArticleToc(props.toc))
const activeId = ref(flattenedToc.value[0]?.id ?? '')
const progress = ref(0)
let scheduledFrame: number | null = null

function updateReadingPosition(): void {
  const links = flattenedToc.value
  let currentId = links[0]?.id ?? ''

  for (const link of links) {
    const headingTop = document.getElementById(link.id)?.getBoundingClientRect().top
    if (headingTop !== undefined && headingTop <= 100) {
      currentId = link.id
    }
  }

  activeId.value = currentId

  const article = document.getElementById('blog-reading-content')
  if (!article) {
    progress.value = 0
    return
  }

  const { top, height } = article.getBoundingClientRect()
  const scrollableHeight = Math.max(1, height - window.innerHeight)
  progress.value = Math.round(Math.max(0, Math.min(1, -top / scrollableHeight)) * 100)
}

function scheduleReadingUpdate(): void {
  if (scheduledFrame !== null) {
    return
  }

  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = null
    updateReadingPosition()
  })
}

watch(() => props.toc, async () => {
  await nextTick()
  updateReadingPosition()
}, { deep: true })

onMounted(() => {
  window.addEventListener('scroll', scheduleReadingUpdate, { passive: true })
  window.addEventListener('resize', scheduleReadingUpdate)
  updateReadingPosition()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleReadingUpdate)
  window.removeEventListener('resize', scheduleReadingUpdate)
  if (scheduledFrame !== null) {
    window.cancelAnimationFrame(scheduledFrame)
  }
})
</script>

<style scoped src="./article-reading-sidebar.css"></style>
