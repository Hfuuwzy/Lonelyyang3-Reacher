<template>
  <Teleport to="body">
    <Transition name="drawer-layer" :duration="drawerTransitionDurationMs">
      <div v-if="open" class="drawer-layer">
        <button
          type="button"
          data-testid="right-nav-overlay"
          class="drawer-overlay"
          aria-label="Close navigation"
          @click="emit('close')"
        />

        <aside
          id="right-nav-drawer"
          ref="drawerElement"
          data-testid="right-nav-drawer"
          class="right-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          @keydown="trapFocus"
        >
          <div class="drawer-heading">
            <p class="drawer-heading__eyebrow">NAVIGATION</p>
            <p class="drawer-heading__title">目录</p>
          </div>

          <nav data-testid="right-nav-links" class="drawer-nav" aria-label="Primary navigation">
            <NuxtLink
              v-for="item in props.items"
              :key="item.key"
              :to="localePath(item.path)"
              :data-testid="item.testId"
              class="drawer-link"
              :class="{ 'drawer-link--active': isActive(item.path) }"
              :aria-current="isActive(item.path) ? 'page' : undefined"
              @click="emit('close')"
            >
              <span class="drawer-link__stamp" aria-hidden="true" />
              <span class="drawer-link__label">{{ localizedLabel(item) }}</span>
              <span class="drawer-link__english">{{ item.englishLabel }}</span>
            </NuxtLink>
          </nav>

          <section data-testid="drawer-tools" class="drawer-tools" :aria-label="t('drawer.tools')">
            <button
              ref="searchToggleElement"
              type="button"
              data-testid="drawer-search-toggle"
              class="drawer-search-toggle"
              :aria-expanded="searchOpen"
              aria-controls="drawer-search-panel"
              @click="toggleSearch"
            >
              <svg class="drawer-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>{{ t('drawer.search') }}</span>
            </button>

            <Transition name="drawer-search-panel">
              <div v-if="searchOpen" id="drawer-search-panel" data-testid="drawer-search-panel" class="drawer-search-panel">
                <UiSearchBar compact input-id="drawer-search" />
              </div>
            </Transition>

            <div class="drawer-tools__row">
              <UiLocaleSwitch />
              <UiThemeToggle />
            </div>
          </section>

        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { PortalNavItem } from '~/data/navigation'

interface Props {
  readonly open: boolean
  readonly items: readonly PortalNavItem[]
}

interface Emits {
  close: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const DRAWER_TRANSITION_DURATION_MS = 700
const REDUCED_DRAWER_TRANSITION_DURATION_MS = 1

const localePath = useLocalePath()
const { locale, t } = useI18n()
const route = useRoute()
const prefersReducedMotion = ref(false)
const drawerTransitionDurationMs = computed(() => prefersReducedMotion.value
  ? REDUCED_DRAWER_TRANSITION_DURATION_MS
  : DRAWER_TRANSITION_DURATION_MS)
const drawerElement = ref<HTMLElement | null>(null)
const searchToggleElement = ref<HTMLButtonElement | null>(null)
const searchOpen = ref(false)
const previouslyFocused = ref<HTMLElement | null>(null)
let reducedMotionMediaQuery: MediaQueryList | null = null

function handleReducedMotionChange(event: MediaQueryListEvent): void {
  prefersReducedMotion.value = event.matches
}

function localizedLabel(item: PortalNavItem): string {
  if (locale.value.startsWith('ja')) {
    return item.labelJa
  }

  return item.labelZh
}

function isActive(path: string): boolean {
  const localizedPath = localePath(path)
  if (path === '/') {
    return route.path === localizedPath
  }

  return route.path === localizedPath || route.path.startsWith(`${localizedPath}/`)
}

function focusableElements(): NodeListOf<HTMLElement> | null {
  return drawerElement.value?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? null
}

async function toggleSearch(): Promise<void> {
  searchOpen.value = !searchOpen.value
  await nextTick()

  if (searchOpen.value) {
    drawerElement.value?.querySelector<HTMLInputElement>('#drawer-search')?.focus()
    return
  }

  searchToggleElement.value?.focus()
}

function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return
  }

  const focusable = focusableElements()
  if (!focusable || focusable.length === 0) {
    return
  }

  const first = focusable.item(0)
  const last = focusable.item(focusable.length - 1)

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
    return
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
  }
}

function cleanupDrawer(): void {
  document.removeEventListener('keydown', handleDocumentKeydown)

  if (previouslyFocused.value?.isConnected) {
    previouslyFocused.value.focus()
  }
  previouslyFocused.value = null
}

watch(() => props.open, async (open) => {
  if (open) {
    previouslyFocused.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', handleDocumentKeydown)
    await nextTick()
    drawerElement.value?.querySelector<HTMLElement>('a[href]')?.focus()
    return
  }

  searchOpen.value = false
  cleanupDrawer()
}, { flush: 'post' })

onMounted(() => {
  reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = reducedMotionMediaQuery.matches
  reducedMotionMediaQuery.addEventListener('change', handleReducedMotionChange)
})

onBeforeUnmount(() => {
  reducedMotionMediaQuery?.removeEventListener('change', handleReducedMotionChange)
  cleanupDrawer()
})
</script>

<style scoped src="./right-nav-drawer.css"></style>
<style scoped src="./right-nav-drawer-tools.css"></style>
