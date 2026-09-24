<template>
  <CategoryLanding nav-key="notes" :items="items" empty-message="技术笔记正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '技术笔记汇总', description: '汇总开发过程中的技术笔记、教程与问题解法。', category: '笔记', tags: ['技术'], href: '/notes#technical-notes' },
] as const satisfies readonly CategoryLandingItem[]
</script>
