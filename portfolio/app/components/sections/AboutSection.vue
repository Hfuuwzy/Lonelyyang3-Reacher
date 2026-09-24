<template>
  <section class="bg-surface rounded-2xl p-8 border border-border">
    <div class="flex flex-col md:flex-row items-center gap-8">
      <!-- 头像 -->
      <div class="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/20 flex-shrink-0">
        <div class="w-full h-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
          <span class="text-4xl">👤</span>
        </div>
      </div>

      <!-- 信息 -->
      <div class="text-center md:text-left">
        <h2 class="text-2xl font-bold mb-2">Hfuuwzy</h2>
        <p class="text-text-secondary mb-4">一个热爱技术、喜欢分享的开发者。在这里记录我的学习笔记、项目经验和生活感悟。</p>

        <!-- 社交链接 -->
        <div class="flex justify-center md:justify-start space-x-3">
          <a
            v-for="social in socials"
            :key="social.name"
            :href="social.url"
            target="_blank"
            rel="noopener noreferrer"
            class="w-10 h-10 rounded-full bg-bg flex items-center justify-center text-text-secondary hover:bg-primary/10 hover:text-primary transition-all"
          >
            <span class="text-lg">{{ social.icon }}</span>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  socials: Array<{
    name: string
    url: string
    icon: string
  }>
}>()
</script>
