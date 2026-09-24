<template>
  <CategoryLanding nav-key="life" :items="items" empty-message="生活记录正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '生活随笔', description: '记录日常生活、阅读片段与偶然浮现的想法。', category: '随笔', tags: ['生活'], href: '/life#essays' },
] as const satisfies readonly CategoryLandingItem[]
</script>
