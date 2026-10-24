<template>
  <article data-testid="article-prose" class="article-prose">
    <ContentRenderer :value="value" :components="components" />
  </article>
</template>

<script setup lang="ts">
import type { PageCollectionItemBase } from '@nuxt/content'
import type { Component } from 'vue'

interface Props {
  readonly value: PageCollectionItemBase
  readonly components?: Readonly<Record<string, Component>>
}

defineProps<Props>()
</script>

<style scoped src="./article-prose.css"></style>
