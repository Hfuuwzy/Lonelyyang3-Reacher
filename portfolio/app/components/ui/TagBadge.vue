<template>
  <span class="tag" :class="colorClass">
    {{ tag }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  tag: string
  color?: 'primary' | 'secondary' | 'accent'
}>()

const colorClass = computed(() => {
  switch (props.color) {
    case 'secondary': return 'bg-secondary/10 text-secondary hover:bg-secondary/20'
    case 'accent': return 'bg-accent/20 text-yellow-700 hover:bg-accent/30'
    default: return 'bg-primary/10 text-primary hover:bg-primary/20'
  }
})
</script>
