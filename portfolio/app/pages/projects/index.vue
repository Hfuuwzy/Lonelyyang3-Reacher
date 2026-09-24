<template>
  <CategoryLanding
    nav-key="projects"
    :items="items"
    empty-message="项目记录正在整理中。"
    layout="feature-list"
  />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  {
    title: 'MyWorks',
    description: '个人专属门户网站，以 Nuxt 构建并持续记录设计与开发实践。',
    category: '开源作品',
    tags: ['Vue', 'TypeScript', 'Nuxt'],
    href: 'https://github.com/Hfuuwzy/MyWorks',
  },
  {
    title: 'More work in progress',
    description: '研究中的想法、试验性实现与下一阶段作品。',
    category: '进行中',
    tags: ['Research', 'Prototype'],
    href: 'https://github.com/Hfuuwzy',
  },
] as const satisfies readonly CategoryLandingItem[]
</script>
