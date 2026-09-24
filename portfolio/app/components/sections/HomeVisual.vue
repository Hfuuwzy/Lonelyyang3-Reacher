<template>
  <section
    id="home-visual"
    data-testid="home-visual"
    class="home-visual"
    aria-labelledby="home-brand"
    :data-intro-mode="introMode"
    :data-intro-state="introState"
    :data-intro-started="introStarted"
    :data-intro-brand-visible="introBrandVisible"
    :data-intro-drop="introDrop"
  >
    <div data-testid="home-artwork-loading" class="home-visual__artwork-loading" aria-hidden="true">
      <img
        class="home-visual__artwork-loading-image"
        src="/images/home/hero-main.png"
        alt=""
        width="1920"
        height="2566"
      >
      <ul class="home-visual__loading-logo" aria-hidden="true">
        <li v-for="logoPath in LOADING_LOGO_PATHS" :key="logoPath">
          <img
            :src="logoPath"
            alt=""
            aria-hidden="true"
            width="724"
            height="2172"
            loading="eager"
            decoding="async"
            draggable="false"
          >
        </li>
      </ul>
    </div>

    <div data-testid="home-visual-stage" class="home-visual__stage">
      <div data-testid="home-visual-info" class="home-visual__info">
        <div class="home-visual__mist" aria-hidden="true" />
        <header class="home-visual__brand-block">
          <h1
            id="home-brand"
            data-testid="home-brand"
            class="home-visual__brand"
            aria-label="Lonelyyang3"
          >
            <img
              data-testid="home-brand-image"
              class="home-visual__brand-image"
              src="/images/brand/lonelyyang3-wordmark.png"
              alt=""
              aria-hidden="true"
              width="2048"
              height="682"
              loading="eager"
              decoding="async"
              draggable="false"
            >
          </h1>
          <div class="home-visual__brand-secondary">
            <img
              data-testid="home-brand-secondary-image"
              class="home-visual__brand-secondary-image"
              src="/images/brand/lonelyyang3-myself-world.png"
              alt="MySelf-World，我与我的世界"
              width="1829"
              height="860"
              loading="eager"
              decoding="async"
              draggable="false"
            >
          </div>
        </header>

        <div id="home-category-nav" data-testid="home-category-nav" class="home-visual__categories">
          <SectionsVerticalCategoryNav :categories="categories" density="hero" />
        </div>

        <aside id="home-media-slot" data-testid="home-media-slot" class="home-visual__media" aria-label="Featured media">
          <span class="home-visual__media-kicker">MEDIA</span>
          <p>影像与声音记录，待作品整理后在此呈现。</p>
        </aside>
      </div>

      <div data-testid="home-artwork-panel" class="home-visual__artwork">
          <img
            id="hero-main-image"
            data-testid="hero-main-image"
            class="home-visual__image"
            src="/images/home/hero-main.png"
            alt="Watercolor storefront artwork for the Lonelyyang3 homepage"
            width="1920"
            height="2566"
            loading="eager"
            fetchpriority="high"
          >
      </div>
    </div>

    <a id="home-scroll-cue" data-testid="home-scroll-cue" class="home-visual__scroll" href="#information">
      <span>向下阅读</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </a>
  </section>
</template>

<script setup lang="ts">
import type { PortalCategory } from '~/data/navigation'

interface Props {
  readonly categories: readonly PortalCategory[]
}

const INTRO_MODE = {
  first: 'first',
  reduced: 'reduced',
} as const

const INTRO_STATE = {
  brand: 'brand',
  artwork: 'artwork',
  handoff: 'handoff',
  settled: 'settled',
} as const

type IntroMode = typeof INTRO_MODE[keyof typeof INTRO_MODE]
type IntroState = typeof INTRO_STATE[keyof typeof INTRO_STATE]

interface IntroTimeline {
  readonly logoAt: number
  readonly brandVisibleAt: number
  readonly artworkAt: number
  readonly dropAt: number
  readonly handoffAt: number
  readonly settledAt: number
}

const LOADING_LOGO_PATHS = [
  '/images/brand/home-intro/logo01-lonely-clean.png',
  '/images/brand/home-intro/logo02-yang-clean.png',
  '/images/brand/home-intro/logo03-3.png',
  '/images/brand/home-intro/logo04-icon.png',
  '/images/brand/home-intro/logo05-wordmark.png',
] as const
const INTRO_TIMELINE = {
  logoAt: 500,
  brandVisibleAt: 5_900,
  artworkAt: 3_800,
  dropAt: 4_400,
  handoffAt: 5_900,
  settledAt: 7_900,
} as const satisfies IntroTimeline

defineProps<Props>()
const homeIntroSettled = useState<boolean>('home-intro-settled', () => false)
const introMode = ref<IntroMode>(INTRO_MODE.first)
const introState = ref<IntroState>(INTRO_STATE.brand)
const introStarted = ref(false)
const introBrandVisible = ref(false)
const introDrop = ref(false)
const introTimers: ReturnType<typeof setTimeout>[] = []
homeIntroSettled.value = false

function scheduleAction(action: () => void, delay: number): void {
  introTimers.push(setTimeout(action, delay))
}

function scheduleTimeline(): void {
  scheduleAction(() => {
    introStarted.value = true
  }, INTRO_TIMELINE.logoAt)
  scheduleAction(() => {
    introBrandVisible.value = true
  }, INTRO_TIMELINE.brandVisibleAt)
  scheduleAction(() => {
    introState.value = INTRO_STATE.artwork
  }, INTRO_TIMELINE.artworkAt)
  scheduleAction(() => {
    introDrop.value = true
  }, INTRO_TIMELINE.dropAt)
  scheduleAction(() => {
    introState.value = INTRO_STATE.handoff
  }, INTRO_TIMELINE.handoffAt)
  scheduleAction(() => {
    introState.value = INTRO_STATE.settled
    homeIntroSettled.value = true
  }, INTRO_TIMELINE.settledAt)
}

onMounted(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    introMode.value = INTRO_MODE.reduced
    introStarted.value = true
    introBrandVisible.value = true
    introDrop.value = true
    introState.value = INTRO_STATE.settled
    homeIntroSettled.value = true
    return
  }

  scheduleTimeline()
})

onBeforeUnmount(() => {
  for (const timer of introTimers) {
    clearTimeout(timer)
  }
  homeIntroSettled.value = false
})
</script>

<style scoped src="./home-visual.css"></style>
<style scoped src="./home-visual-motion.css"></style>
