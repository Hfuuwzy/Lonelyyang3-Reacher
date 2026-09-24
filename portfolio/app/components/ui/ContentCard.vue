<template>
  <article class="card group cursor-pointer">
    <!-- 封面图片 -->
    <div v-if="cover && !coverLoadFailed" class="aspect-video overflow-hidden">
      <img
        :src="cover"
        :alt="title"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        loading="lazy"
        @error="coverLoadFailed = true"
      />
    </div>
    <div v-else class="aspect-video bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
      <span class="text-4xl">{{ icon }}</span>
    </div>

    <!-- 内容 -->
    <div class="p-5">
      <!-- 分类和日期 -->
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-primary">{{ category }}</span>
        <time class="text-xs text-text-secondary">{{ formatDate(date) }}</time>
      </div>

      <!-- 标题 -->
      <h3 class="font-bold text-lg mb-2 line-clamp-2 group-hover:text-primary transition-colors">
        {{ title }}
      </h3>

      <!-- 摘要 -->
      <p class="text-sm text-text-secondary line-clamp-2 mb-3">
        {{ description }}
      </p>

      <!-- 标签 -->
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="tag in tags"
          :key="tag"
          class="tag"
        >
          {{ tag }}
        </span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
interface Props {
  title: string
  description?: string
  cover?: string
  date?: string | Date
  category?: string
  tags?: string[]
  icon?: string
  path?: string
}

const props = withDefaults(defineProps<Props>(), {
  description: '',
  date: '',
  category: '',
  tags: () => [],
  icon: '📄',
  path: '/',
})

const coverLoadFailed = ref(false)

watch(() => props.cover, () => {
  coverLoadFailed.value = false
})

const formatDate = (date: string | Date) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
</script>
