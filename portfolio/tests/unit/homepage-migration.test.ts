// @vitest-environment happy-dom
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  Suspense,
  watch,
} from 'vue'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomePage from '../../app/pages/index.vue'
import HomeVisual from '../../app/components/sections/HomeVisual.vue'
import HomePaperTransition from '../../app/components/sections/HomePaperTransition.vue'
import HomeAgentGuide from '../../app/components/HomeAgentGuide.vue'
import HomeDetailsFooter from '../../app/components/HomeDetailsFooter.vue'
import ChronologicalFeed from '../../app/components/sections/ChronologicalFeed.vue'
import ArticleRow from '../../app/components/content/ArticleRow.vue'
import PaperSectionHeading from '../../app/components/content/PaperSectionHeading.vue'

const posts = [
  {
    path: '/blog/first-real-article',
    title: '真实文章一',
    description: '第一篇近期文章',
    date: '2026-10-23',
    category: '技术',
    tags: ['真实内容'],
  },
  {
    path: '/blog/second-real-article',
    title: '真实文章二',
    description: '第二篇近期文章',
    date: '2026-10-22',
    category: '研究',
    tags: ['阅读'],
  },
]

const NuxtLinkStub = defineComponent({
  props: ['to', 'prefetch'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

const EmptyComponent = defineComponent({
  setup() {
    return () => null
  },
})

function stubNuxtGlobals(reducedMotion: boolean) {
  const homeIntroSettled = ref(false)
  const route = ref({ path: '/', fullPath: '/' })
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })

  vi.stubGlobal('definePageMeta', vi.fn())
  vi.stubGlobal('useRoute', () => route.value)
  vi.stubGlobal('useLocalePath', () => (path: string) => path)
  vi.stubGlobal('useI18n', () => ({ locale: ref('zh-CN'), t: (key: string) => key }))
  vi.stubGlobal('useState', (key: string, initialValue: () => unknown) => (
    key === 'home-intro-settled' ? homeIntroSettled : ref(initialValue())
  ))
  vi.stubGlobal('useAsyncData', async (_key: string, load: () => Promise<unknown>) => ({
    data: ref(await load()),
  }))
  vi.stubGlobal('queryCollection', () => ({
    order: () => ({ all: async () => posts }),
  }))
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)

  return {
    homeIntroSettled,
    restoreMatchMedia() {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      })
    },
  }
}

async function mountHomepage(reducedMotion = false) {
  const globals = stubNuxtGlobals(reducedMotion)
  const host = defineComponent({
    setup() {
      return () => h(Suspense, null, {
        default: () => h(HomePage),
        fallback: () => h('p', 'Loading homepage'),
      })
    },
  })
  const wrapper = mount(host, {
    attachTo: document.body,
    global: {
      components: {
        NuxtLink: NuxtLinkStub,
        SectionsHomeVisual: HomeVisual,
        SectionsHomePaperTransition: HomePaperTransition,
        SectionsVerticalCategoryNav: EmptyComponent,
        HomeAgentGuide,
        HomeDetailsFooter,
        DecorPatternDecoration: EmptyComponent,
        PaperSectionHeading,
        SectionsChronologicalFeed: ChronologicalFeed,
        ArticleRow,
      },
    },
  })

  await flushPromises()
  await nextTick()
  return { wrapper, ...globals }
}

describe('production homepage migration', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('keeps the full hero and moves the settled agent guide to the real A showcase', async () => {
    vi.useFakeTimers()
    const { wrapper, homeIntroSettled, restoreMatchMedia } = await mountHomepage()
    try {
      const hero = wrapper.get('[data-testid="hero-main-image"]')
      expect(hero.attributes('src')).toBe('/images/home/hero-main.png')
      expect(hero.attributes('width')).toBe('1920')
      expect(hero.attributes('height')).toBe('2566')
      expect(wrapper.get('#home-scroll-cue').attributes('href')).toBe('#tools')
      expect(window.location.hash).toBe('')

      const guide = wrapper.get('.agent-guide')
      expect(guide.attributes('inert')).toBeDefined()
      expect(guide.get('a[href="#tools"]').exists()).toBe(true)
      expect(wrapper.get('#tools').exists()).toBe(true)
      expect(wrapper.get('.tool-entry').attributes('href')).toBe('/agents/paper')
      expect(wrapper.get('.reading-scene figcaption').text()).toContain('非真实任务结果')
      expect(wrapper.get('.tool-input').text()).toContain('单篇 PDF')
      expect(wrapper.get('.tool-input').text()).toContain('受支持的 arXiv')
      expect(wrapper.get('.tool-note').text()).toContain('质量')
      expect(wrapper.get('#information').attributes('aria-labelledby')).toBe('information-heading')
      expect(wrapper.get('h2#information-heading').text()).toBe('最近更新')

      const orderedSections = ['#home-visual', '#tools', '#information', '#home-about', '[data-testid="home-details-footer"]']
        .map(selector => wrapper.get(selector).element)
      expect(orderedSections.every((element, index) => (
        index === 0 || Boolean(orderedSections[index - 1]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      ))).toBe(true)

      expect(wrapper.get('a[href="/blog/first-real-article"]').text()).toContain('真实文章一')
      expect(wrapper.get('a[href="/blog/second-real-article"]').text()).toContain('真实文章二')
      expect(wrapper.text()).not.toContain('待作品整理')
      expect(wrapper.text()).not.toContain('入口预演')
      expect(wrapper.text()).not.toContain('敬请期待')
      expect(wrapper.find('form').exists()).toBe(false)

      vi.advanceTimersByTime(7_900)
      await nextTick()
      expect(homeIntroSettled.value).toBe(true)
      expect(wrapper.get('.agent-guide').attributes('inert')).toBeUndefined()
      expect(wrapper.get('.agent-guide a[href="#tools"]').exists()).toBe(true)
    }
    finally {
      wrapper.unmount()
      restoreMatchMedia()
    }
  })

  it('ships the user-generated wash and excludes the reference-derived preview', () => {
    expect(existsSync(resolve('public/images/prototype/home-wash.png'))).toBe(true)
    expect(existsSync(resolve('public/images/prototype/reference-wash-preview.png'))).toBe(false)
  })

  it('keeps the same showcase reachable immediately when reduced motion is enabled', async () => {    const { wrapper, homeIntroSettled, restoreMatchMedia } = await mountHomepage(true)
    try {
      expect(homeIntroSettled.value).toBe(true)
      expect(wrapper.get('[data-testid="home-visual"]').attributes('data-intro-mode')).toBe('reduced')
      expect(wrapper.get('[data-testid="home-visual"]').attributes('data-intro-state')).toBe('settled')
      expect(wrapper.get('.agent-guide').attributes('inert')).toBeUndefined()
      expect(wrapper.get('.agent-guide a[href="#tools"]').exists()).toBe(true)
      expect(wrapper.get('.tool-entry').attributes('href')).toBe('/agents/paper')
    }
    finally {
      wrapper.unmount()
      restoreMatchMedia()
    }
  })
})
