<template>
  <section class="relative overflow-hidden bg-mesh rounded-2xl p-8 lg:p-12 mb-8">
    <!-- 装饰元素 -->
    <div class="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
    <div class="absolute bottom-0 left-0 w-48 h-48 bg-secondary/5 rounded-full blur-3xl"></div>
    <div class="absolute top-1/2 right-1/4 w-32 h-32 bg-accent/10 rounded-full blur-2xl animate-float"></div>

    <!-- 内容 -->
    <div class="relative z-10">
      <h1 class="text-3xl lg:text-5xl font-bold mb-4">
        <span class="text-gradient">欢迎来到我的个人门户</span>
      </h1>
      <p class="text-lg text-text-secondary mb-8 max-w-2xl">
        这里记录了我的技术学习、开源项目、生活感悟和各种推荐内容。希望这些内容能对你有所帮助。
      </p>

      <!-- 统计数据 -->
      <div class="flex flex-wrap gap-8">
        <div v-for="stat in stats" :key="stat.label" class="text-center">
          <div class="text-3xl font-bold text-primary">{{ stat.value }}</div>
          <div class="text-sm text-text-secondary mt-1">{{ stat.label }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  stats: Array<{ value: string; label: string }>
}>()
</script>
