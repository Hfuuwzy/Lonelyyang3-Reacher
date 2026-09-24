<template>
  <article data-testid="article-prose" class="article-prose">
    <ContentRenderer :value="value" />
  </article>
</template>

<script setup lang="ts">
import type { PageCollectionItemBase } from '@nuxt/content'

interface Props {
  readonly value: PageCollectionItemBase
}

defineProps<Props>()
</script>

<style scoped src="./article-prose.css"></style>
