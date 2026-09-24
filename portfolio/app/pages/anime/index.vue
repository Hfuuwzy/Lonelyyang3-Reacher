<template>
  <CategoryLanding nav-key="anime" :items="items" empty-message="动画记录正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '每月新番推荐', description: '按月记录值得关注的新作动画。', category: '新番', tags: ['月度'], href: '/anime#monthly' },
  { title: '经典动漫回顾', description: '重新观看经典作品并整理长久留下的感受。', category: '经典', tags: ['回顾'], href: '/anime#classics' },
] as const satisfies readonly CategoryLandingItem[]
</script>
