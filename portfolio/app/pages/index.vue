<template>
  <div class="home-page">
    <SectionsHomeVisual :categories="portalCategories" />
    <SectionsHomePaperTransition />

    <section id="information" class="home-page__information" aria-labelledby="information-heading">
      <DecorPatternDecoration variant="wash" />
      <div class="home-page__section-inner">
        <PaperSectionHeading
          stamp="新"
          english="Information"
          title="最近更新"
          description="依时间顺序收录技术文章与日常思考。"
        />
        <div id="information-heading" class="home-page__feed">
          <SectionsChronologicalFeed :posts="sortedPosts" variant="home" />
        </div>
      </div>
    </section>

    <section class="home-page__summaries" aria-label="Projects and about">
      <div class="home-page__section-inner home-page__summary-grid">
        <article class="home-page__summary">
          <PaperSectionHeading
            stamp="作"
            english="Projects"
            title="开源作品"
            description="持续整理个人项目、技术实验与开放源码记录。"
          />
          <NuxtLink class="home-page__summary-link" :to="localePath('/projects')">浏览项目记录</NuxtLink>
        </article>
        <article class="home-page__summary">
          <PaperSectionHeading
            stamp="人"
            english="About"
            title="关于我"
            description="记录学习路径、兴趣方向，以及作品背后的想法。"
          />
          <NuxtLink class="home-page__summary-link" :to="localePath('/about')">阅读个人简介</NuxtLink>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { portalCategories } from '~/data/navigation'
import type { ArticleListItem } from '~/utils/articles'
import { sortArticlesByDateDesc } from '~/utils/articles'

definePageMeta({
  layout: 'default',
})

const localePath = useLocalePath()
const { data: blogPosts } = await useAsyncData('home-blog-posts', () =>
  queryCollection('blog')
    .order('date', 'DESC')
    .all()
)

const sortedPosts = computed<readonly ArticleListItem[]>(() => sortArticlesByDateDesc(
  (blogPosts.value ?? []).map(post => ({
    path: post.path,
    title: post.title,
    description: post.description,
    date: post.date,
    category: post.category,
    tags: post.tags,
    cover: post.cover,
  })),
))
</script>

<style scoped src="./home-page.css"></style>
