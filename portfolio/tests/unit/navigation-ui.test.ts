// @vitest-environment happy-dom
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type VNode,
} from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DefaultLayout from '../../app/layouts/default.vue'
import HomeVisual from '../../app/components/sections/HomeVisual.vue'
import RightNavDrawer from '../../app/components/layout/RightNavDrawer.vue'
import RightNavRail from '../../app/components/layout/RightNavRail.vue'
import { portalCategories, portalNavItems } from '../../app/data/navigation'

const BRAND_LAYERS = [
  '/images/brand/home-intro/logo01-lonely-clean.png',
  '/images/brand/home-intro/logo02-yang-clean.png',
  '/images/brand/home-intro/logo03-3.png',
  '/images/brand/home-intro/logo04-icon.png',
  '/images/brand/home-intro/logo05-wordmark.png',
]

const NuxtLinkStub = defineComponent({
  props: ['to'],
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () => h(
      'a',
      { href: props.to, onClick: (event: MouseEvent) => emit('click', event) },
      slots.default?.(),
    )
  },
})

const IconStub = defineComponent({
  props: ['open', 'testId'],
  setup(props) {
    return () => h('span', { 'data-testid': props.testId })
  },
})

const EmptyComponent = defineComponent({
  setup() {
    return () => null
  },
})

const LayoutFooterStub = defineComponent({
  setup() {
    return () => h('footer', { 'data-testid': 'layout-footer' })
  },
})

const LanguageControlStub = defineComponent({
  setup() {
    return () => h('button', { 'data-testid': 'drawer-language-control' }, 'Language')
  },
})

const ThemeControlStub = defineComponent({
  setup() {
    return () => h('button', { 'data-testid': 'drawer-theme-control' }, 'Theme')
  },
})

function setupNuxtGlobals(path: string, reducedMotion = false, localeCode = 'zh-CN') {
  const route = reactive({ path, fullPath: path })
  const homeIntroSettled = ref(false)
  const locale = ref(localeCode)

  vi.stubGlobal('useLocalePath', () => (to: string) => (
    localeCode === 'ja' ? (to === '/' ? '/ja' : `/ja${to}`) : to
  ))
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useI18n', () => ({ locale, t: (key: string) => key }))
  vi.stubGlobal('useState', (key: string, initialValue: () => unknown) => {
    if (key === 'home-intro-settled') {
      return homeIntroSettled
    }

    return ref(initialValue())
  })
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function mountDefaultLayout(content: VNode = h('p', 'Page content')) {
  return mount(DefaultLayout, {
    attachTo: document.body,
    slots: { default: () => content },
    global: {
      stubs: { transition: true },
      components: {
        LayoutFooter: LayoutFooterStub,
        LayoutRightNavDrawer: RightNavDrawer,
        LayoutRightNavRail: RightNavRail,
        NuxtLink: NuxtLinkStub,
        IconsPaperIcons: IconStub,
        UiSearchBar: EmptyComponent,
        UiLocaleSwitch: LanguageControlStub,
        UiThemeToggle: ThemeControlStub,
        UiScrollToTop: EmptyComponent,
        SectionsVerticalCategoryNav: EmptyComponent,
      },
    },
  })
}

describe('site navigation UI', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('renders the five approved logo layers together without changing their canvas', () => {
    vi.stubGlobal('useLocalePath', () => (path: string) => path)

    const wrapper = mount(RightNavRail, {
      props: { open: false },
      global: {
        components: {
          NuxtLink: NuxtLinkStub,
          IconsPaperIcons: IconStub,
        },
      },
    })

    const logoLink = wrapper.get('[data-testid="right-nav-brand"]')
    const layers = logoLink.findAll('img')

    expect(layers.map(layer => layer.attributes('src'))).toEqual(BRAND_LAYERS)
    expect(layers.every(layer => layer.attributes('alt') === '')).toBe(true)
    expect(layers.every(layer => (
      layer.attributes('width') === '724' && layer.attributes('height') === '2172'
    ))).toBe(true)
    expect(layers.every(layer => (
      layer.element.parentElement === layers[0]?.element.parentElement
    ))).toBe(true)
    expect(wrapper.get('[data-testid="right-nav-menu-button"]').attributes('aria-expanded')).toBe('false')

    wrapper.unmount()
  })

  it('defers home navigation until intro settles but keeps it mounted on other pages', async () => {
    setupNuxtGlobals('/')
    vi.useFakeTimers()
    const home = mountDefaultLayout(h(HomeVisual, { categories: portalCategories }))

    expect(home.find('[data-testid="right-nav-rail"]').exists()).toBe(false)
    expect(home.find('[data-testid="right-nav-drawer"]').exists()).toBe(false)
    expect(home.find('[data-testid="layout-footer"]').exists()).toBe(false)

    vi.advanceTimersByTime(7_899)
    await nextTick()
    expect(home.find('[data-testid="right-nav-rail"]').exists()).toBe(false)

    vi.advanceTimersByTime(1)
    await nextTick()

    expect(home.find('[data-testid="home-visual"]').attributes('data-intro-state')).toBe('settled')
    expect(home.find('[data-testid="right-nav-rail"]').exists()).toBe(true)
    home.unmount()

    setupNuxtGlobals('/about')
    const about = mountDefaultLayout()
    expect(about.find('[data-testid="right-nav-rail"]').exists()).toBe(true)
    expect(about.find('[data-testid="layout-footer"]').exists()).toBe(true)
    about.unmount()
  })

  it('reaches the same settled home navigation immediately for reduced motion', async () => {
    setupNuxtGlobals('/', true)
    const home = mountDefaultLayout(h(HomeVisual, { categories: portalCategories }))
    await nextTick()

    expect(home.find('[data-testid="home-visual"]').attributes('data-intro-mode')).toBe('reduced')
    expect(home.find('[data-testid="home-visual"]').attributes('data-intro-state')).toBe('settled')
    expect(home.find('[data-testid="right-nav-rail"]').exists()).toBe(true)

    home.unmount()
  })

  it('keeps drawer focus contained and restores it without changing page scroll', async () => {
    setupNuxtGlobals('/about')
    const wrapper = mountDefaultLayout()
    const trigger = wrapper.get('[data-testid="right-nav-menu-button"]')
    trigger.element.focus()
    document.body.style.overflow = 'clip'

    await trigger.trigger('click')
    await nextTick()

    const drawer = document.querySelector<HTMLElement>('[data-testid="right-nav-drawer"]')
    const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')
    expect(drawer?.getAttribute('role')).toBe('dialog')
    expect(drawer?.getAttribute('aria-modal')).toBe('true')
    expect(wrapper.get('[data-testid="right-nav-menu-button"]').attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(focusable?.item(0))
    expect(document.body.style.overflow).toBe('clip')
    expect(drawer?.querySelector('[data-testid="drawer-language-control"]')).not.toBeNull()
    expect(drawer?.querySelector('[data-testid="drawer-theme-control"]')).not.toBeNull()

    const firstFocusable = focusable?.item(0)
    const lastFocusable = focusable?.item(focusable.length - 1)
    const reverseTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    firstFocusable?.dispatchEvent(reverseTab)
    expect(reverseTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(lastFocusable)

    const forwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    lastFocusable?.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(firstFocusable)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(document.querySelector('[data-testid="right-nav-drawer"]')).toBeNull()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    expect(document.body.style.overflow).toBe('clip')

    await trigger.trigger('click')
    await nextTick()
    document.querySelector<HTMLButtonElement>('[data-testid="right-nav-overlay"]')?.click()
    await nextTick()
    expect(document.querySelector('[data-testid="right-nav-drawer"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)

    wrapper.unmount()
  })

  it('keeps localized cross-page navigation usable and closes after a link is followed', async () => {
    setupNuxtGlobals('/ja/about', false, 'ja')
    const wrapper = mountDefaultLayout()
    const trigger = wrapper.get('[data-testid="right-nav-menu-button"]')
    trigger.element.focus()
    await trigger.trigger('click')
    await nextTick()

    const blogLink = document.querySelector<HTMLAnchorElement>('[data-testid="nav-link-blog"]')
    const aboutLink = document.querySelector<HTMLAnchorElement>('[data-testid="nav-link-about"]')
    expect(blogLink?.getAttribute('href')).toBe('/ja/blog')
    expect(blogLink?.textContent).toContain('ブログ')
    expect(aboutLink?.getAttribute('aria-current')).toBe('page')
    blogLink?.click()
    await nextTick()

    expect(document.querySelector('[data-testid="right-nav-drawer"]')).toBeNull()
    wrapper.unmount()
  })
})
