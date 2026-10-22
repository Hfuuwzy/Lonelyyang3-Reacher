<template>
  <!-- The parent route owns the transient paper-review session and renders the
       child routes (workbench / deep-read report / full-text translation) as
       NuxtPage, so the PDF object URL and adopted result survive child
       navigation without history, storage, or module singletons. -->
  <NuxtPage />
</template>

<script setup lang="ts">
import { providePaperReviewSession } from '~/composables/paper-review-session'

definePageMeta({ layout: 'default' })

// The session lives here: children provide nothing back to the parent beyond
// adopting a finished result; credentials stay inside the workbench child.
const session = providePaperReviewSession()

function handlePageHide(): void {
  // The tab left the page (navigate-away or backgrounding): the transient PDF
  // object URL must not outlive the page that created it.
  session.clear()
}

onMounted(() => {
  window.addEventListener('pagehide', handlePageHide)
})

onUnmounted(() => {
  window.removeEventListener('pagehide', handlePageHide)
  session.clear()
})
</script>