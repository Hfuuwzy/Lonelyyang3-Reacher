<template>
  <section class="mb-8">
    <div class="flex items-center justify-between mb-6">
      <h2 class="section-title mb-0">最新内容</h2>
      <NuxtLink to="/blog" class="text-sm text-primary hover:underline">查看全部 →</NuxtLink>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <NuxtLink
        v-for="post in posts"
        :key="post.path"
        :to="post.path"
      >
        <UiContentCard
          :title="post.title ?? ''"
          :description="post.description"
          :cover="post.cover"
          :date="post.date"
          :category="post.category"
          :tags="post.tags || []"
        />
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  posts: Array<{
    path: string
    title?: string
    description?: string
    cover?: string
    date?: string | Date
    category?: string
    tags?: string[]
  }>
}>()
</script>
