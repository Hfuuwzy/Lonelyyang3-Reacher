// @vitest-environment happy-dom
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileStyle, parse } from 'vue/compiler-sfc'
import RightNavDrawer from '../../app/components/layout/RightNavDrawer.vue'
import RightNavRail from '../../app/components/layout/RightNavRail.vue'
import { portalNavItems } from '../../app/data/navigation'

const MAIN_STYLES_PATH = resolve(process.cwd(), 'app/assets/css/main.css')
const RAIL_COMPONENT_PATH = resolve(process.cwd(), 'app/components/layout/RightNavRail.vue')
const DRAWER_COMPONENT_PATH = resolve(process.cwd(), 'app/components/layout/RightNavDrawer.vue')

const NuxtLinkStub = defineComponent({
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

const EmptyStub = defineComponent({
  setup() {
    return () => null
  },
})

let themeStyles: HTMLStyleElement[] = []

function setupNuxtGlobals(): void {
  vi.stubGlobal('useLocalePath', () => (path: string) => path)
  vi.stubGlobal('useI18n', () => ({ locale: ref('zh-CN'), t: (key: string) => key }))
  vi.stubGlobal('useRoute', () => ({ path: '/about' }))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))

  const themeStyle = document.createElement('style')
  themeStyle.dataset.testid = 'navigation-theme-styles'
  themeStyle.textContent = readFileSync(MAIN_STYLES_PATH, 'utf8').replace(/@tailwind\s+[^;]+;/g, '')
  document.head.append(themeStyle)
  themeStyles.push(themeStyle)
  installComponentStyles(RAIL_COMPONENT_PATH)
  installComponentStyles(DRAWER_COMPONENT_PATH)
}

function installComponentStyles(componentPath: string): void {
  const { descriptor, errors } = parse(readFileSync(componentPath, 'utf8'), { filename: componentPath })
  if (errors.length > 0) {
    throw errors[0]
  }

  for (const style of descriptor.styles) {
    const source = style.src
      ? readFileSync(resolve(dirname(componentPath), style.src), 'utf8')
      : style.content
    const compiled = compileStyle({
      filename: componentPath,
      id: 'navigation-theme-test',
      scoped: false,
      source,
    })
    if (compiled.errors.length > 0) {
      throw compiled.errors[0]
    }

    const styleElement = document.createElement('style')
    styleElement.textContent = compiled.code
    document.head.append(styleElement)
    themeStyles.push(styleElement)
  }
}

afterEach(() => {
  themeStyles.forEach(style => style.remove())
  themeStyles = []
  document.documentElement.classList.remove('dark')
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('navigation theme contrast', () => {
  it('keeps the paper rail texture light in light mode and readable over a dark surface in dark mode', async () => {
    setupNuxtGlobals()
    const rail = mount(RightNavRail, {
      attachTo: document.body,
      props: { open: false },
      global: { components: { NuxtLink: NuxtLinkStub, IconsPaperIcons: EmptyStub } },
    })
    const drawer = mount(RightNavDrawer, {
      attachTo: document.body,
      props: { open: true, items: portalNavItems },
      global: {
        stubs: { transition: true },
        components: {
          NuxtLink: NuxtLinkStub,
          UiSearchBar: EmptyStub,
          UiLocaleSwitch: EmptyStub,
          UiThemeToggle: EmptyStub,
        },
      },
    })
    await nextTick()

    const railElement = rail.get('[data-testid="right-nav-rail"]').element
    const drawerElement = document.querySelector<HTMLElement>('[data-testid="right-nav-drawer"]')
    expect(drawerElement).not.toBeNull()

    const lightRailStyle = window.getComputedStyle(railElement)
    expect(lightRailStyle.backgroundColor).toBe('rgba(250, 248, 242, 0.97)')
    expect(lightRailStyle.backgroundImage).toContain('paper-nav.jpg')
    expect(['', 'normal']).toContain(lightRailStyle.backgroundBlendMode)

    document.documentElement.classList.add('dark')

    const darkRailStyle = window.getComputedStyle(railElement)
    const darkDrawerStyle = window.getComputedStyle(drawerElement!)
    expect(darkRailStyle.backgroundColor).toBe('rgba(23, 27, 34, 0.97)')
    expect(darkRailStyle.backgroundImage).toContain('paper-nav.jpg')
    expect(darkRailStyle.backgroundBlendMode).toBe('multiply')
    expect(darkRailStyle.color).toBe('#f2eadb')
    expect(darkDrawerStyle.backgroundColor).toBe('rgba(23, 27, 34, 0.97)')
    expect(darkDrawerStyle.color).toBe('#f2eadb')

    rail.unmount()
    drawer.unmount()
  })
})
