import { expect, test } from '@playwright/test'

test('persisted dark theme applies before the drawer opens', async ({ page }) => {
  // Given a visitor previously selected dark mode
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'))

  // When a fresh page loads without opening the drawer
  await page.goto('/')

  // Then the root theme is already dark and no drawer-only control is duplicated
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0)
})

test('system dark preference applies when no theme is saved', async ({ page }) => {
  // Given a visitor has no saved theme and prefers a dark color scheme
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => localStorage.removeItem('theme'))

  // When a fresh page loads without opening the drawer
  await page.goto('/')

  // Then the system fallback applies immediately
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByTestId('theme-toggle')).toHaveCount(0)
})

test('mouse activation of a search result reaches the localized article', async ({ page }) => {
  // Given a Japanese drawer search with a real result
  await page.goto('/ja')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('right-nav-menu-button').click()
  await page.getByTestId('drawer-search-toggle').click()
  await page.getByTestId('drawer-search-input').fill('Linux')
  const result = page.getByTestId('search-result-linux-commands')
  await expect(result).toBeVisible()

  // When the result is clicked with the mouse
  await result.click()

  // Then navigation reaches the localized detail route
  await expect(page).toHaveURL(/\/ja\/blog\/linux-commands$/)
  await expect(page.getByTestId('blog-detail')).toBeVisible()
})

test('keyboard activation of a search result reaches the localized article', async ({ page }) => {
  // Given a focused Japanese search result
  await page.goto('/ja')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('right-nav-menu-button').click()
  await page.getByTestId('drawer-search-toggle').click()
  await page.getByTestId('drawer-search-input').fill('Linux')
  const result = page.getByTestId('search-result-linux-commands')
  await expect(result).toBeVisible()
  await result.focus()

  // When Enter activates the result
  await result.press('Enter')

  // Then navigation reaches the localized detail route
  await expect(page).toHaveURL(/\/ja\/blog\/linux-commands$/)
  await expect(page.getByTestId('blog-detail')).toBeVisible()
})

test('Japanese homepage and navigation preserve locale and active state', async ({ page }) => {
  // Given the Japanese homepage is fully hydrated
  await page.goto('/ja')
  await page.waitForLoadState('networkidle')

  // Then homepage and rail links remain in Japanese locale
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.getByTestId('home-latest-update')).toHaveAttribute('href', '/ja/blog/linux-commands')
  await expect(page.getByRole('link', { name: '浏览项目记录' })).toHaveAttribute('href', '/ja/projects')
  await expect(page.getByRole('link', { name: '阅读个人简介' })).toHaveAttribute('href', '/ja/about')
  await expect(page.getByTestId('right-nav-brand')).toHaveAttribute('href', '/ja')

  // When the drawer opens on home
  await page.getByTestId('right-nav-menu-button').click()

  // Then its destinations and active state are localized
  await expect(page.getByTestId('nav-link-home')).toHaveAttribute('href', '/ja')
  await expect(page.getByTestId('nav-link-blog')).toHaveAttribute('href', '/ja/blog')
  await expect(page.getByTestId('nav-link-projects')).toHaveAttribute('href', '/ja/projects')
  await expect(page.getByTestId('nav-link-home')).toHaveAttribute('aria-current', 'page')

  // When the Japanese blog route opens
  await page.goto('/ja/blog')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('right-nav-menu-button').click()

  // Then the blog item is the localized active destination
  await expect(page.getByTestId('nav-link-blog')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
})

test('scroll-to-top is an accessible paper stamp outside the fixed rail', async ({ page }) => {
  // Given a reader has scrolled beyond the homepage hero
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.scrollTo(0, 1200))
  const button = page.getByTestId('scroll-to-top')
  await expect(button).toBeVisible()

  // Then the control is outside the rail and follows the paper-stamp contract
  const buttonBox = await button.boundingBox()
  const railBox = await page.getByTestId('right-nav-rail').boundingBox()
  expect(buttonBox).not.toBeNull()
  expect(railBox).not.toBeNull()
  if (buttonBox && railBox) {
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(railBox.x - 8)
  }
  await expect(button).toHaveCSS('border-radius', '0px')
  await expect(button).toHaveCSS('box-shadow', 'none')
  await expect(button).toHaveCSS('border-style', 'solid')
  const transitionProperties = await button.evaluate(element => getComputedStyle(element).transitionProperty.split(',').map(value => value.trim()))
  expect(transitionProperties.every(property => property === 'opacity' || property === 'transform')).toBe(true)

  // When the stamp is clicked
  await button.click()

  // Then the document returns to the top
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
})

test('article detail renders its frontmatter tags', async ({ page }) => {
  // Given an article with Linux and command-line tags
  await page.goto('/blog/linux-commands')

  // Then both tags are visible in the detail header
  const tags = page.getByTestId('article-tags')
  await expect(tags).toBeVisible()
  await expect(tags).toContainText('Linux')
  await expect(tags).toContainText('命令行')
})
