<template>
  <section data-testid="category-landing-about" class="about-page">
    <PaperSectionHeading
      stamp="自介"
      english="ABOUT"
      title="关于我"
      description="在技术、写作与日常之间，持续记录仍在生长的自己。"
    />

    <div class="about-page__portrait">
      <figure data-testid="about-visual" class="about-page__visual">
        <PatternDecoration variant="asanoha" />
        <span class="about-page__monogram" aria-hidden="true">H</span>
        <figcaption>Hfuuwzy · Developer & Writer</figcaption>
      </figure>

      <header data-testid="about-introduction" class="about-page__introduction">
        <p>自己紹介</p>
        <h2>技术与日常之间<br>保持好奇</h2>
      </header>

      <div data-testid="about-body" class="about-page__body">
        <p class="about-page__lead">你好，我是 Hfuuwzy，一个热爱技术、喜欢分享的<span data-testid="about-developer-role" class="about-page__role">开发者</span>。</p>
        <p>这里收录我在前端开发、工具探索与持续学习中的笔记，也保存电影、音乐和生活里值得记住的片段。</p>
        <p>我相信清晰的表达和可靠的实现同样重要，因此一边构建作品，一边把过程整理成可以再次阅读的文字。</p>
      </div>
    </div>

    <section data-testid="about-skills" class="about-page__section" aria-labelledby="about-skills-title">
      <div class="about-page__section-heading">
        <p>SKILLS</p>
        <h2 id="about-skills-title">技能</h2>
      </div>
      <ul class="about-page__skills">
        <li v-for="skill in skills" :key="skill.name">
          <span>{{ skill.name }}</span>
          <span>{{ skill.area }}</span>
        </li>
      </ul>
    </section>

    <section data-testid="about-experience" class="about-page__section" aria-labelledby="about-experience-title">
      <div class="about-page__section-heading">
        <p>EXPERIENCE</p>
        <h2 id="about-experience-title">经历</h2>
      </div>
      <ol class="about-page__timeline">
        <li v-for="event in timeline" :key="event.date">
          <time :datetime="event.date">{{ event.date }}</time>
          <div>
            <h3>{{ event.title }}</h3>
            <p>{{ event.description }}</p>
          </div>
        </li>
      </ol>
    </section>

    <nav data-testid="about-links" class="about-page__links" aria-label="社交链接">
      <a href="https://github.com/Hfuuwzy" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18c-4.5 1.5-4.5-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3 0 6.1-1.5 6.1-6.5A5.1 5.1 0 0 0 18.8 4.5 4.7 4.7 0 0 0 18.7 1S17.6.6 15 2.3a13.4 13.4 0 0 0-6 0C6.4.6 5.3 1 5.3 1a4.7 4.7 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.8 8c0 5 3.1 6.5 6.1 6.5a3.4 3.4 0 0 0-.9 2.6V21" /></svg>
        <span>GitHub</span>
      </a>
      <a href="https://x.com/" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4L4 20" /></svg>
        <span>X / Twitter</span>
      </a>
      <a href="https://www.bilibili.com/" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3l4 4 4-4M5 8h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zm3 5v3m8-3v3" /></svg>
        <span>Bilibili</span>
      </a>
    </nav>
  </section>
</template>

<script setup lang="ts">
import PaperSectionHeading from '~/components/content/PaperSectionHeading.vue'
import PatternDecoration from '~/components/decor/PatternDecoration.vue'

definePageMeta({ layout: 'default' })

const skills = [
  { name: 'Vue.js / Nuxt.js', area: 'Frontend' },
  { name: 'TypeScript / Node.js', area: 'Development' },
  { name: 'Python / MySQL', area: 'Data & Service' },
  { name: 'Linux / Git / Docker', area: 'Tooling' },
] as const

const timeline = [
  { date: '2025', title: '开始构建个人门户', description: '使用 Nuxt.js 搭建个人专属网站。' },
  { date: '2024', title: '持续学习中', description: '探索新技术，参与开源项目。' },
  { date: '2023', title: '技术博客起步', description: '开始记录技术笔记和学习心得。' },
] as const
</script>

<style scoped src="./about.css"></style>
