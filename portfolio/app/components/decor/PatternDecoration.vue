<template>
  <span class="pattern-decoration" :class="`pattern-decoration--${variant}`" aria-hidden="true">
    <span class="pattern-decoration__layer pattern-decoration__layer--one" />
    <span class="pattern-decoration__layer pattern-decoration__layer--two" />
  </span>
</template>

<script setup lang="ts">
interface Props {
  readonly variant?: 'asanoha' | 'checker' | 'wash'
}

withDefaults(defineProps<Props>(), {
  variant: 'asanoha',
})
</script>

<style scoped src="./pattern-decoration.css"></style>
