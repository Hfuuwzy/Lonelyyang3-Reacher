<template>
  <section class="mb-8">
    <h2 class="section-title">内容分类</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <NuxtLink
        v-for="category in categories"
        :key="category.path"
        :to="category.path"
        class="group p-5 bg-surface rounded-xl border border-border hover:border-primary/50 hover:shadow-card transition-all duration-300"
      >
        <div class="text-3xl mb-3 group-hover:scale-110 transition-transform">{{ category.icon }}</div>
        <h3 class="font-semibold text-sm mb-1">{{ category.name }}</h3>
        <p class="text-xs text-text-secondary">{{ category.count }} 篇内容</p>
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  categories: Array<{
    name: string
    path: string
    icon: string
    count: number
  }>
}>()
</script>
