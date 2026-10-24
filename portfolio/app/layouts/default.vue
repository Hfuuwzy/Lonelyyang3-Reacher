<template>
  <div data-testid="site-shell" class="site-shell">
    <div class="site-content">
      <main data-testid="site-main" class="site-main">
        <slot />
      </main>

      <LayoutFooter v-if="!isHomeRoute" />
    </div>

    <LayoutRightNavDrawer
      v-if="navigationVisible"
      :open="navOpen"
      :items="portalNavItems"
      @close="closeNavigation"
    />
    <LayoutRightNavRail
      v-if="navigationVisible"
      :open="navOpen"
      @toggle="toggleNavigation"
      @close="closeNavigation"
    />
    <UiScrollToTop />
  </div>
</template>

<script setup lang="ts">
import { portalNavItems } from '~/data/navigation'

const route = useRoute()
const localePath = useLocalePath()
const homeIntroSettled = useState<boolean>('home-intro-settled', () => false)
const navOpen = ref(false)
const isHomeRoute = computed(() => route.path === '/' || route.path === localePath('/'))
const navigationVisible = computed(() => !isHomeRoute.value || homeIntroSettled.value)

function closeNavigation(): void {
  navOpen.value = false
}

function toggleNavigation(): void {
  navOpen.value = !navOpen.value
}

watch(() => route.fullPath, () => {
  closeNavigation()
  if (isHomeRoute.value) {
    homeIntroSettled.value = false
  }
}, { flush: 'sync' })

watch(navigationVisible, (visible) => {
  if (visible) {
    return
  }

  closeNavigation()
}, { flush: 'sync' })
</script>

<style scoped>
.site-shell {
  --site-rail-width: var(--right-rail-width-desktop);
  --site-axis-gutter: max(24px, calc(var(--site-rail-width) + 20px));

  display: flex;
  flex-direction: column;
  min-block-size: 100dvh;
  background: var(--paper);
  color: var(--ink);
}

.site-content {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
  padding-inline-end: var(--site-rail-width);
}

.site-main {
  flex: 1 0 auto;
  min-inline-size: 0;
}

@media (width < 1024px) {
  .site-shell {
    --site-rail-width: var(--right-rail-width-tablet);
  }

  .site-content {
    padding-inline-end: var(--site-rail-width);
  }
}

@media (width < 768px) {
  .site-shell {
    --site-rail-width: var(--right-rail-width-mobile);
  }

  .site-content {
    padding-inline-end: var(--site-rail-width);
  }
}
</style>
