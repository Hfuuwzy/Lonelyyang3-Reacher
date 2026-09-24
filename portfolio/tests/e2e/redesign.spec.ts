import { expect, test } from '@playwright/test'

test.describe('right rail redesign shell', () => {
  test('renders the right rail and no old left sidebar on the homepage', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('right-nav-rail')).toBeVisible()
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.getByTestId('site-main')).toBeVisible()
  })

  test('opens and closes the right drawer with keyboard, overlay, and Escape', async ({ page }) => {
    await page.goto('/')

    const menuButton = page.getByTestId('right-nav-menu-button')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')

    await menuButton.press('Enter')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('right-nav-drawer')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

    await page.keyboard.press('Escape')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')

    await menuButton.click()
    await page.getByTestId('right-nav-overlay').click({ position: { x: 10, y: 10 } })
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  test('exposes the approved rail and drawer IDs at responsive rail widths', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    const rail = page.getByTestId('right-nav-rail')
    const menuButton = page.getByTestId('right-nav-menu-button')
    await expect(page.getByTestId('right-nav-brand')).toBeVisible()
    await expect(page.getByTestId('right-nav-menu-icon')).toHaveCount(1)
    await expect(page.getByTestId('right-nav-close-icon')).toHaveCount(0)
    await expect(rail).toHaveCSS('width', '80px')

    await menuButton.click()
    await expect(page.getByTestId('right-nav-menu-icon')).toHaveCount(0)
    await expect(page.getByTestId('right-nav-close-icon')).toHaveCount(1)
    await expect(page.getByTestId('right-nav-links')).toBeVisible()
    await expect(page.getByTestId('right-nav-close')).toBeVisible()

    await page.setViewportSize({ width: 900, height: 800 })
    await expect(rail).toHaveCSS('width', '64px')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rail).toHaveCSS('width', '56px')
  })

  test('traps focus and restores page state after Escape, close, and route navigation', async ({ page }) => {
    await page.goto('/')

    const menuButton = page.getByTestId('right-nav-menu-button')
    const firstLink = page.getByTestId('nav-link-home')
    const closeButton = page.getByTestId('right-nav-close')

    await menuButton.click()
    await expect(firstLink).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(closeButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(firstLink).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menuButton).toBeFocused()
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')

    await menuButton.click()
    await closeButton.click()
    await expect(menuButton).toBeFocused()

    await menuButton.click()
    await page.getByTestId('nav-link-blog').click()
    await expect(page).toHaveURL(/\/blog$/)
    await expect(page.getByTestId('right-nav-drawer')).toHaveCount(0)
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
    await expect(menuButton).toBeFocused()
  })

  test('renders search locale and theme controls only inside the expanded drawer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('drawer-search-input')).toHaveCount(0)
    await expect(page.getByTestId('locale-switch')).toHaveCount(0)
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0)

    await page.getByTestId('right-nav-menu-button').click()
    await page.getByTestId('drawer-search-toggle').click()

    await expect(page.getByTestId('drawer-search-input')).toHaveCount(1)
    await expect(page.getByTestId('locale-switch')).toHaveCount(1)
    await expect(page.getByTestId('theme-toggle')).toHaveCount(1)
    await expect(page.getByTestId('drawer-tools').getByTestId('drawer-search-input')).toBeVisible()
  })

  test('search finds existing posts and links through the current locale', async ({ page }) => {
    await page.goto('/ja')
    await page.getByTestId('right-nav-menu-button').click()
    await page.getByTestId('drawer-search-toggle').click()
    await page.getByTestId('drawer-search-input').fill('Linux')

    await expect(page.getByTestId('search-result-linux-commands')).toBeVisible()
    await expect(page.getByTestId('search-result-linux-commands')).toHaveAttribute('href', '/ja/blog/linux-commands')
  })

  test('theme toggle preserves the existing dark-mode behavior', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('right-nav-menu-button').click()
    await page.getByTestId('theme-toggle').click()

    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.evaluate(() => window.localStorage.getItem('theme'))).resolves.toBe('dark')
  })
})

test('blog index uses chronological rows instead of the old card grid wall', async ({ page }) => {
  await page.goto('/blog')

  await expect(page.getByTestId('category-landing-blog')).toBeVisible()
  await expect(page.getByTestId('article-row-linux-commands')).toBeVisible()
  await expect(page.locator('.card')).toHaveCount(0)
  await expect(page.locator('.grid.lg\\:grid-cols-3')).toHaveCount(0)
})

test('homepage renders H-01 through H-05 with real DOM layers', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('home-visual')).toBeVisible()
  await expect(page.getByTestId('hero-main-image')).toHaveAttribute('src', /\/images\/reference\/deaimon\/hero-main\.png/)
  await expect(page.getByTestId('home-brand')).toContainText('MyWorks')
  await expect(page.getByTestId('home-latest-update')).toContainText('Linux常用命令')
  await expect(page.getByTestId('home-category-nav').getByRole('link')).toHaveCount(8)
  await expect(page.getByTestId('home-media-slot')).toBeVisible()
  await expect(page.getByTestId('right-nav-rail')).toBeVisible()
})

test('homepage feed uses F-01 and F-02 even odd allocation without duplicates', async ({ page }) => {
  await page.goto('/')

  const primary = page.getByTestId('feed-column-primary')
  const secondary = page.getByTestId('feed-column-secondary')

  await expect(primary.getByTestId('article-row-linux-commands')).toBeVisible()
  await expect(secondary.getByTestId('article-row-ai-thinking')).toBeVisible()
  await expect(primary.getByTestId('article-row-mysql-basics')).toBeVisible()
  await expect(secondary.getByTestId('article-row-linux-commands')).toHaveCount(0)
})

test('homepage remains free of console errors while article links are idle', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(consoleErrors).toEqual([])
})

test('homepage mobile categories use one horizontally browsable vertical group', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const categoryContainer = page.getByTestId('home-category-nav')
  const categoryNav = categoryContainer.getByRole('navigation')

  await expect(categoryNav).toHaveCSS('flex-wrap', 'nowrap')
  await expect.poll(() => categoryContainer.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect.poll(() => categoryContainer.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(200)
})

test('homepage mobile copy starts below the protected hero face region', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect.poll(() => page.getByTestId('home-visual').evaluate(element => getComputedStyle(element).getPropertyValue('--mobile-hero-safe-area').trim())).toBe('75svh')
  await expect.poll(() => page.getByTestId('home-brand').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(630)
})
