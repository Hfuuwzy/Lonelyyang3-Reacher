import { expect, test } from '@playwright/test'

const shellRoutes = [
  '/',
  '/blog',
  '/blog/linux-commands',
  '/projects',
  '/movies',
  '/anime',
  '/music',
  '/tools',
  '/life',
  '/notes',
  '/about',
] as const

const localizedShellRoutes = shellRoutes.map(route => route === '/' ? '/ja' : `/ja${route}`)

test('Japanese routes never request locale-prefixed shared images', async ({ page }) => {
  // Given shared paper textures are root-level public assets
  const localizedImageFailures: string[] = []
  const requestedSharedImages = new Set<string>()
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.includes('/images/reference/deaimon/paper-')) {
      requestedSharedImages.add(pathname)
    }
  })
  page.on('response', (response) => {
    if (response.url().includes('/ja/images/') && response.status() >= 400) {
      localizedImageFailures.push(`${response.status()} ${response.url()}`)
    }
  })

  // When representative Japanese routes render their shared shell and content
  for (const route of ['/ja', '/ja/blog', '/ja/blog/linux-commands', '/ja/about'] as const) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
  }

  // Then no shared image is resolved beneath the locale prefix
  expect(localizedImageFailures).toEqual([])
  expect(requestedSharedImages).toEqual(new Set([
    '/images/reference/deaimon/paper-body.jpg',
    '/images/reference/deaimon/paper-nav.jpg',
    '/images/reference/deaimon/paper-section.jpg',
  ]))
})

test('every approved default and Japanese route renders the right-rail shell without console errors', async ({ page }) => {
  // Given every completed portal route is part of the approved shell
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  // When each default and Japanese route is loaded
  for (const route of [...shellRoutes, ...localizedShellRoutes]) {
    await page.goto(route)
    await expect(page.getByTestId('site-shell')).toBeVisible()
    await expect(page.getByTestId('right-nav-rail')).toBeVisible()
  }

  // Then the application emitted no console errors on any route
  expect(consoleErrors).toEqual([])
})

test('article detail exposes the established test contract and locale navigation', async ({ page }) => {
  // Given an existing article in the Japanese locale
  // When its detail route and drawer locale controls render
  await page.goto('/ja/blog/linux-commands')

  // Then detail regions and surrounding navigation use stable IDs
  await expect(page.getByTestId('blog-detail')).toBeVisible()
  await expect(page.getByTestId('blog-detail-title')).toContainText('Linux常用命令')
  await expect(page.getByTestId('blog-detail-meta')).toContainText('Linux')
  await expect(page.getByTestId('blog-detail-cover')).toBeVisible()
  await expect(page.getByTestId('article-prose')).toContainText('文件操作')
  await expect(page.getByTestId('article-prev-link')).toHaveAttribute('href', /^\/ja\/blog\//)
  await expect(page.getByTestId('article-next-link')).toHaveAttribute('href', /^\/ja\/blog\//)
  await expect(page.getByTestId('article-back-link')).toHaveAttribute('href', '/ja/blog')

  await page.getByTestId('right-nav-menu-button').click()
  const localeSwitch = page.getByTestId('locale-switch')
  await expect(localeSwitch.getByRole('link', { name: /中文/ })).toHaveAttribute('href', '/blog/linux-commands')
  await expect(localeSwitch.getByRole('link', { name: /日本語/ })).toHaveAttribute('href', '/ja/blog/linux-commands')
})

test('unknown article routes retain explicit 404 responses in both locales', async ({ request }) => {
  // Given an article slug absent from Content
  // When both locale variants are requested
  const [defaultResponse, japaneseResponse] = await Promise.all([
    request.get('/blog/not-a-real-article'),
    request.get('/ja/blog/not-a-real-article'),
  ])

  // Then neither route falls through to a successful shell response
  expect(defaultResponse.status()).toBe(404)
  expect(japaneseResponse.status()).toBe(404)
})

test('Japanese project links remain absolute external URLs', async ({ page }) => {
  // Given the localized projects page contains external work links
  // When the page renders through the localized category landing
  await page.goto('/ja/projects')

  // Then locale routing does not prefix either external destination
  const projectLinks = page.getByTestId('category-list-projects').locator('a')
  await expect(projectLinks).toHaveCount(2)
  await expect(projectLinks.nth(0)).toHaveAttribute('href', 'https://github.com/Hfuuwzy/MyWorks')
  await expect(projectLinks.nth(1)).toHaveAttribute('href', 'https://github.com/Hfuuwzy')
})

test('rail and drawer use the approved desktop tablet and mobile widths', async ({ context }) => {
  // Given the shell responds at each approved breakpoint
  const widths = [
    { viewport: 1280, rail: 80, drawer: 1280 * 0.48, heroPosition: '50% 18%' },
    { viewport: 900, rail: 64, drawer: 648, heroPosition: '58% 38%' },
    { viewport: 390, rail: 56, drawer: 390, heroPosition: '72% 42%' },
  ] as const

  for (const width of widths) {
    // When the drawer opens at this viewport
    const page = await context.newPage()
    await page.setViewportSize({ width: width.viewport, height: 844 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('hero-main-image')).toHaveCSS('object-position', width.heroPosition)
    const menuButton = page.getByTestId('right-nav-menu-button')
    await menuButton.click()
    await expect(page.getByTestId('right-nav-drawer')).toBeVisible()

    // Then rail and drawer geometry match the design contract
    await expect.poll(() => page.getByTestId('right-nav-rail').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(width.rail)
    const drawerWidth = await page.getByTestId('right-nav-drawer').evaluate(element => element.getBoundingClientRect().width)
    expect(drawerWidth).toBeCloseTo(width.drawer, 0)
    await page.close()
  }
})

test('dark mode and reduced motion retain their accessibility contracts', async ({ page }) => {
  // Given a reduced-motion visitor opens the drawer
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await page.goto('/')
  const lightBackground = await page.getByTestId('site-shell').evaluate(element => getComputedStyle(element).backgroundColor)
  const lightDrawerBackground = await page.getByTestId('right-nav-rail').evaluate(element => getComputedStyle(element).backgroundColor)
  await page.getByTestId('right-nav-menu-button').click()

  // Then drawer motion is effectively disabled
  const transitionDuration = await page.getByTestId('right-nav-drawer').evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))
  expect(transitionDuration).toBeLessThanOrEqual(0.001)

  // When dark mode is activated
  await page.getByTestId('theme-toggle').click()

  // Then theme state and rendered paper color both change
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.evaluate(() => localStorage.getItem('theme'))).resolves.toBe('dark')
  await expect.poll(() => page.getByTestId('site-shell').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground)
  await expect.poll(() => page.getByTestId('right-nav-drawer').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(lightDrawerBackground)
})

test('mobile home blog detail and about routes do not overflow the document', async ({ page }) => {
  // Given the narrow target viewport
  await page.setViewportSize({ width: 390, height: 844 })

  // When each representative content route renders
  for (const route of ['/', '/blog', '/blog/linux-commands', '/about'] as const) {
    await page.goto(route)

    // Then the document remains within its viewport
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})

test('about headings remain inset from the desktop viewport edge', async ({ page }) => {
  // Given the desktop about composition
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/about')

  // When the shared heading and section labels are measured
  const headings = page.locator('.paper-section-heading, .about-page__section-heading')

  // Then no heading is clipped against the left viewport edge
  await expect(headings).toHaveCount(3)
  for (const heading of await headings.all()) {
    await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(32)
  }

  // And the semantic role remains together within one computed line box
  const role = page.getByTestId('about-developer-role')
  await expect(role).toHaveText('开发者')
  await expect(role).toHaveCSS('white-space', 'nowrap')
  const roleMetrics = await role.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(styles.lineHeight),
    }
  })
  expect(roleMetrics.height).toBeLessThanOrEqual(roleMetrics.lineHeight * 1.1)
})

test('captures the final approved route evidence', async ({ page }) => {
  // Given the required route and viewport evidence matrix
  const captures = [
    { route: '/', width: 1440, height: 900, file: 'home-desktop.png' },
    { route: '/', width: 390, height: 844, file: 'home-mobile.png' },
    { route: '/blog', width: 1440, height: 900, file: 'blog-index-desktop.png' },
    { route: '/ja/blog/linux-commands', width: 390, height: 844, file: 'ja-blog-detail-mobile.png' },
    { route: '/about', width: 1440, height: 900, file: 'about-desktop.png' },
  ] as const

  for (const capture of captures) {
    // When the route has fully settled at its target viewport
    await page.setViewportSize({ width: capture.width, height: capture.height })
    await page.goto(capture.route)
    await page.waitForLoadState('networkidle')

    if (capture.route === '/blog' || capture.route === '/about') {
      const surface = page.locator(capture.route === '/blog' ? '.blog-index' : '.about-page')
      await expect(surface).toHaveCSS('background-image', /paper-body\.jpg/)
      await expect(surface).not.toHaveCSS('text-shadow', 'none')
      await expect(surface).toHaveCSS('box-shadow', 'none')
    }

    // Then a fresh full-page PNG records the current build
    await page.screenshot({ path: `test-results/final/${capture.file}`, fullPage: true })
  }
})
