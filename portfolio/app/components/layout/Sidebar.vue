<template>
  <aside
    class="sidebar"
    :class="{ collapsed: !open }"
  >
    <!-- Logo -->
    <div class="p-6 border-b border-border">
      <NuxtLink to="/" class="flex items-center space-x-3" @click="closeMobile">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
          <span class="text-white font-bold text-lg">M</span>
        </div>
        <div>
          <h1 class="font-bold text-lg text-text">MyWorks</h1>
          <p class="text-xs text-text-secondary">个人专属门户</p>
        </div>
      </NuxtLink>
    </div>

    <!-- 导航菜单 -->
    <nav class="p-4 space-y-1 overflow-y-auto flex-1">
      <NuxtLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center space-x-3 px-4 py-3 rounded-xl text-text-secondary hover:bg-primary/10 hover:text-primary transition-all duration-200 group"
        active-class="!bg-primary/15 !text-primary font-medium"
        @click="closeMobile"
      >
        <span class="text-xl group-hover:scale-110 transition-transform">{{ item.icon }}</span>
        <span class="text-sm">{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <!-- 社交链接 -->
    <div class="p-4 border-t border-border">
      <div class="flex justify-center space-x-3">
        <a
          v-for="social in socialLinks"
          :key="social.name"
          :href="social.url"
          target="_blank"
          rel="noopener noreferrer"
          class="w-9 h-9 rounded-full bg-bg flex items-center justify-center text-text-secondary hover:bg-primary/10 hover:text-primary transition-all"
          :title="social.name"
        >
          <span class="text-sm">{{ social.icon }}</span>
        </a>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const closeMobile = () => {
  if (window.innerWidth < 1024) {
    emit('update:open', false)
  }
}

const navItems = [
  { path: '/', label: '首页', icon: '🏠' },
  { path: '/blog', label: '博客', icon: '📝' },
  { path: '/projects', label: '开源作品', icon: '💻' },
  { path: '/movies', label: '电影推荐', icon: '🎬' },
  { path: '/anime', label: '动漫推荐', icon: '📺' },
  { path: '/music', label: '音乐推荐', icon: '🎵' },
  { path: '/tools', label: '工具资源', icon: '🔧' },
  { path: '/life', label: '生活随笔', icon: '🌸' },
  { path: '/notes', label: '技术笔记', icon: '📚' },
  { path: '/about', label: '关于我', icon: '👤' },
]

const socialLinks = [
  { name: 'GitHub', url: 'https://github.com/Hfuuwzy', icon: '🐙' },
  { name: 'Twitter', url: '#', icon: '🐦' },
  { name: 'Bilibili', url: '#', icon: '📺' },
]
</script>
