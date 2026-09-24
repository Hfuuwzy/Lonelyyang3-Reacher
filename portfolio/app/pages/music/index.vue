<template>
  <CategoryLanding nav-key="music" :items="items" empty-message="音乐记录正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '推荐歌单', description: '收集工作、阅读与日常时反复聆听的音乐。', category: '歌单', tags: ['音乐'], href: '/music#playlist' },
] as const satisfies readonly CategoryLandingItem[]
</script>
