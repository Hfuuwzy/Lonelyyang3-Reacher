<template>
  <CategoryLanding nav-key="movies" :items="items" empty-message="电影与剧集记录正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '推荐电影列表', description: '整理值得重温的电影与观后感。', category: '电影', tags: ['推荐'], href: '/movies#films' },
  { title: '推荐剧集列表', description: '记录近期观看与长期收藏的剧集。', category: '剧集', tags: ['推荐'], href: '/movies#series' },
] as const satisfies readonly CategoryLandingItem[]
</script>
