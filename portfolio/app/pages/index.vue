<template>
  <div class="home-page">
    <SectionsHomeVisual
      :categories="portalCategories"
      scroll-target="#tools"
      media-label="智能体使用导览"
    >
      <template #media>
        <HomeAgentGuide :active="introSettled" />
      </template>
    </SectionsHomeVisual>
    <SectionsHomePaperTransition class="continuation-edge" />

    <div class="home-continuation">
      <section id="tools" class="tools" aria-labelledby="tools-title">
        <div class="tools-inner">
          <header class="tools-heading">
            <p class="eyebrow">TOOLS / 不止于记录</p>
            <h2 id="tools-title">写在这里，也用在这里。</h2>
            <p>一些学习中的难题，试着用工具解开。</p>
          </header>

          <div class="tool-layout">
            <div class="tool-intro">
              <p class="tool-kicker">01 / 论文阅读工具</p>
              <h3>论文翻译与深读</h3>
              <p class="tool-description">
                把一篇外文论文，带进自己的阅读节奏。生成中文译文或深读稿，继续阅读，也可以下载 Markdown。
              </p>
              <p class="tool-input">单篇 PDF · 受支持的 arXiv 链接</p>
              <NuxtLink class="tool-entry" :to="localePath('/agents/paper')">
                进入论文工作台 <span aria-hidden="true">↗</span>
              </NuxtLink>
              <p class="tool-note">
                可选择翻译、深读或两者。生成稿可能遗漏或误读内容，需对照原文核验；深读只作阅读辅助，不替代原文或专业判断。正式 PDF 导出受质量与逐页检查限制。
              </p>
            </div>

            <figure class="reading-scene" aria-label="论文输入与阅读稿的形态示意">
              <div class="source-sheet">
                <span>PDF / arXiv</span>
                <strong>一篇论文</strong>
                <div class="ink-lines" aria-hidden="true" />
              </div>
              <div class="result-sheet">
                <span>中文阅读稿</span>
                <strong>从原文出发，<br>读到自己的理解。</strong>
                <div class="ink-lines" aria-hidden="true" />
                <p>全文译文 / 深读稿</p>
              </div>
              <figcaption>阅读成果形态示意，非真实任务结果</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section id="information" class="home-page__information" aria-labelledby="information-heading">
        <DecorPatternDecoration variant="wash" />
        <div class="home-page__section-inner">
          <PaperSectionHeading
            stamp="新"
            english="Information"
            title="最近更新"
            title-id="information-heading"
            description="依时间顺序收录技术文章与日常思考。"
          />
          <div class="home-page__feed">
            <SectionsChronologicalFeed :posts="sortedPosts" variant="home" />
          </div>
        </div>
      </section>

      <section id="home-about" class="home-page__summaries" aria-label="关于">
        <div class="home-page__section-inner home-about-inner">
          <PaperSectionHeading
            stamp="人"
            english="About"
            title="关于我"
            description="记录学习路径、兴趣方向，以及作品背后的想法。"
          />
          <div class="home-about-copy">
            <p>这里不只有写下来的想法，<br>也有把想法做出来的尝试。</p>
            <NuxtLink class="home-page__summary-link" :to="localePath('/about')">
              阅读个人简介 <span aria-hidden="true">→</span>
            </NuxtLink>
          </div>
        </div>
      </section>
    </div>

    <HomeDetailsFooter />
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
const introSettled = useState<boolean>('home-intro-settled', () => false)
const { data: blogPosts } = await useAsyncData('home-blog-posts', () =>
  queryCollection('blog')
    .order('date', 'DESC')
    .all(),
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
