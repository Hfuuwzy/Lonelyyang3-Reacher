<template>
  <CategoryLanding nav-key="tools" :items="items" empty-message="工具与资源记录正在整理中。" />
</template>

<script setup lang="ts">
import CategoryLanding from '~/components/content/CategoryLanding.vue'
import type { CategoryLandingItem } from '~/components/content/CategoryLanding.vue'

definePageMeta({ layout: 'default' })

const items = [
  { title: '开发工具推荐', description: '记录提升开发体验与工作效率的工具。', category: '工具', tags: ['开发'], href: '/tools#development' },
  { title: '学习资源汇总', description: '汇集长期使用的文档、课程与参考资料。', category: '资源', tags: ['学习'], href: '/tools#learning' },
] as const satisfies readonly CategoryLandingItem[]
</script>
