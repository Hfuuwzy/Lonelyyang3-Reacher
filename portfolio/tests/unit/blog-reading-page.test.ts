// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computed,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  Suspense,
  watch,
  type Component,
  type VNode,
} from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BlogArticlePage from '../../app/pages/blog/[...slug].vue'

const sidebarStyles = readFileSync(resolve(process.cwd(), 'app/components/content/article-reading-sidebar.css'), 'utf8')
const articleProseStyles = readFileSync(resolve(process.cwd(), 'app/components/content/article-prose.css'), 'utf8')
const typographyStyles = readFileSync(resolve(process.cwd(), 'app/pages/blog/blog-detail-typography.css'), 'utf8')

interface TocFixture {
  readonly id: string
  readonly text: string
  readonly depth: number
  readonly children?: readonly TocFixture[]
}

interface ArticleFixture {
  readonly path: string
  readonly title: string
  readonly description?: string
  readonly date?: string | Date
  readonly category?: string
  readonly tags?: readonly string[]
  readonly body: { readonly toc: { readonly links: readonly TocFixture[] } }
}

const toc: readonly TocFixture[] = [
  {
    id: 'first-chapter',
    text: 'First chapter',
    depth: 2,
    children: [{ id: 'first-subsection', text: 'First subsection', depth: 3 }],
  },
  { id: 'second-chapter', text: 'Second chapter', depth: 2 },
]

const currentArticle: ArticleFixture = {
  path: '/blog/current-article',
  title: 'Current article',
  description: 'A long-form article',
  date: '2026-10-20',
  category: 'Research',
  tags: ['current-only', 'reader-layout'],
  body: { toc: { links: toc } },
}

const articleCollection = [
  { path: '/blog/newer', title: 'Newer article', date: '2026-10-21', tags: ['other-tag'] },
  currentArticle,
  { path: '/blog/older', title: 'Older article', date: '2026-10-19', tags: ['not-current'] },
  { path: '/blog/oldest', title: 'Oldest article', date: '2026-10-18' },
]

const NuxtLinkStub = defineComponent({
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

function renderHeadings(links: readonly TocFixture[]): VNode[] {
  return links.flatMap(link => [
    h(`h${link.depth}`, { id: link.id }, link.text),
    ...renderHeadings(link.children ?? []),
  ])
}

const ContentRendererStub = defineComponent({
  props: ['value', 'components'],
  setup(props: { value: ArticleFixture; components?: Readonly<Record<string, Component>> }) {
    return () => h('div', { 'data-testid': 'article-prose' }, [
      ...renderHeadings(props.value.body.toc.links),
      h('p', [h('code', { 'data-testid': 'inline-code' }, 'inline code')]),
      props.components?.table
        ? h(props.components.table, null, {
            default: () => h('tbody', [h('tr', [h('td', 'A native table cell')])]),
          })
        : h('table', [h('tbody', [h('tr', [h('td', 'A native table cell')])])]),
    ])
  },
})

function installNuxtGlobals(options: {
  readonly locale?: 'zh' | 'ja'
  readonly page?: ArticleFixture
} = {}) {
  const locale = ref(options.locale ?? 'zh')
  const page = options.page ?? currentArticle
  const surroundings = [
    { path: '/blog/older', title: 'Older article' },
    { path: '/blog/newer', title: 'Newer article' },
  ]

  vi.stubGlobal('definePageMeta', vi.fn())
  vi.stubGlobal('useRoute', () => reactive({ path: `/${locale.value === 'ja' ? 'ja/' : ''}blog/current-article` }))
  vi.stubGlobal('useLocalePath', () => (path: string) => locale.value === 'ja' ? `/ja${path}` : path)
  vi.stubGlobal('useI18n', () => ({ locale }))
  vi.stubGlobal('useSeoMeta', vi.fn())
  vi.stubGlobal('useAsyncData', async (_key: unknown, load: () => Promise<unknown>) => ({ data: ref(await load()) }))
  vi.stubGlobal('queryCollection', () => ({
    path: () => ({ first: async () => page }),
    order: () => ({ all: async () => articleCollection }),
  }))
  vi.stubGlobal('queryCollectionItemSurroundings', async () => surroundings)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('nextTick', nextTick)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
}

async function renderBlogPage(): Promise<string> {
  const app = createSSRApp(BlogArticlePage)
  app.component('NuxtLink', NuxtLinkStub)
  app.component('ContentRenderer', ContentRendererStub)
  return renderToString(app)
}

async function mountBlogPage() {
  const host = defineComponent({
    setup() {
      return () => h(Suspense, null, {
        default: () => h(BlogArticlePage),
        fallback: () => h('p', 'Loading'),
      })
    },
  })
  const wrapper = mount(host, {
    attachTo: document.body,
    global: {
      components: {
        NuxtLink: NuxtLinkStub,
        ContentRenderer: ContentRendererStub,
      },
    },
  })

  await flushPromises()
  return wrapper
}

describe('real blog article reading experience', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-unit-test-styles]')
      .forEach(stylesheet => stylesheet.remove())
  })

  it('shows current-article tags and real localized reading paths without borrowing other tags', async () => {
    installNuxtGlobals({ locale: 'ja' })
    const html = await renderBlogPage()

    expect(html).toContain('Current article</h1>')
    expect(html).toContain('aria-label="この記事のタグ"')
    expect(html).toContain('data-testid="article-tags"')
    expect(html).toContain('current-only')
    expect(html).not.toContain('other-tag')
    expect(html).toContain('aria-label="最近の記事"')
    expect(html).toContain('href="/ja/blog/newer"')
    expect(html).toContain('href="/ja/blog/older"')
    expect(html).not.toContain('Oldest article')
    expect(html).toContain('data-testid="article-prev-link"')
    expect(html).toContain('data-testid="article-next-link"')
    expect(html).toContain('href="/ja/blog"')
    expect(html).toContain('href="#first-chapter" aria-current="location" aria-expanded="true"')
    expect(html).toContain('href="#first-subsection"')
    expect(html).toContain('role="region" aria-label="文章表格；内容过宽时可横向滚动"')
    expect(html).toContain('<table')
    expect(html).toContain('A native table cell')
  })

  it.each([undefined, []])('omits the article tag group when the article declares no tags (%s)', async (tags) => {
    installNuxtGlobals({ page: { ...currentArticle, tags } })
    const html = await renderBlogPage()

    expect(html).not.toContain('aria-label="本文标签"')
    expect(html).not.toContain('data-testid="article-tags"')
  })

  it.each([
    ['zh', 'Noto Serif SC', 'Noto Serif JP'],
    ['ja', 'Noto Serif JP', 'Noto Serif SC'],
  ] as const)('uses the %s locale across article content and sidebar typography', async (locale, firstFont, laterFont) => {
    installNuxtGlobals({ locale })
    const stylesheets = [
      ['article-typography', typographyStyles],
      ['article-prose', articleProseStyles],
      ['sidebar', sidebarStyles],
    ].map(([name, content]) => {
      const stylesheet = document.createElement('style')
      stylesheet.dataset.unitTestStyles = name
      stylesheet.textContent = content
      document.head.append(stylesheet)
      return stylesheet
    })
    const wrapper = await mountBlogPage()

    try {
      const article = wrapper.get('[data-testid="blog-detail"]')
      expect(article.attributes('lang')).toBe(locale)

      const typographyTargets = [
        article.element,
        wrapper.get('.blog-detail__title').element,
        wrapper.get('.article-prose').element,
        wrapper.get('.article-prose h2').element,
        wrapper.get('.article-reading-sidebar').element,
        wrapper.get('[data-testid="inline-code"]').element,
      ]
      const fontFamilies = typographyTargets.map(target => window.getComputedStyle(target).fontFamily)

      for (const fontFamily of fontFamilies) {
        expect(fontFamily.indexOf(firstFont)).toBeGreaterThanOrEqual(0)
        expect(fontFamily.indexOf(firstFont)).toBeLessThan(fontFamily.indexOf(laterFont))
      }
      expect(new Set(fontFamilies).size).toBe(1)
    }
    finally {
      wrapper.unmount()
      stylesheets.forEach(stylesheet => stylesheet.remove())
    }
  })

  it.each([1_024, 1_440, 1_920])('keeps the desktop TOC sticky at %i px and follows nested headings', async (viewportWidth) => {
    installNuxtGlobals()
    const previousViewport = { width: window.innerWidth, height: window.innerHeight }
    window.happyDOM.setViewport({ width: viewportWidth, height: 900 })
    const stylesheet = document.createElement('style')
    stylesheet.dataset.unitTestStyles = 'article-reading-sidebar'
    // Vitest does not install scoped SFC CSS in happy-dom, so apply the real
    // sidebar sheet and assert its computed UI behavior through CSSOM.
    stylesheet.textContent = sidebarStyles
    document.head.append(stylesheet)
    const headingTops = new Map([
      ['first-chapter', 220],
      ['first-subsection', 40],
      ['second-chapter', 560],
    ])
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.id === 'blog-reading-content' ? -360 : headingTops.get(this.id) ?? 500
      const height = this.id === 'blog-reading-content' ? 1_800 : 24
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 1_344,
        bottom: top + height,
        width: 1_344,
        height,
        toJSON: () => ({}),
      }
    })

    const wrapper = await mountBlogPage()
    try {
      const toc = wrapper.get('[aria-label="本文目录"]')

      expect(toc.exists()).toBe(true)
      expect(window.getComputedStyle(toc.element.parentElement!).position).toBe('sticky')
      expect(toc.get('a[href="#first-chapter"]').attributes('aria-expanded')).toBe('true')
      expect(toc.get('a[href="#first-subsection"]').attributes('aria-current')).toBe('location')
      expect(toc.get('[aria-label="阅读进度"]').text()).toBe('40%')

      headingTops.set('first-chapter', -160)
      headingTops.set('first-subsection', -80)
      headingTops.set('second-chapter', 50)
      window.dispatchEvent(new Event('scroll'))
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      await nextTick()

      expect(toc.get('a[href="#second-chapter"]').attributes('aria-current')).toBe('location')
      expect(toc.find('a[href="#first-subsection"]').exists()).toBe(false)
      expect(toc.get('a[href="#first-chapter"]').attributes('aria-expanded')).toBe('false')
    }
    finally {
      wrapper.unmount()
      stylesheet.remove()
      window.happyDOM.setViewport(previousViewport)
    }
  })
})
