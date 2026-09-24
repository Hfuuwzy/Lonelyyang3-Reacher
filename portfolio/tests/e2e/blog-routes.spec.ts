import { expect, test } from '@playwright/test'

test('blog index renders a date-desc paper timeline with a text category filter', async ({ page }) => {
  // Given the blog collection has Linux, AI, and MySQL articles
  // When the reader opens the blog index
  await page.goto('/blog')

  // Then the paper timeline is date-desc and the category filter narrows it
  const landing = page.getByTestId('category-landing-blog')
  const rows = landing.locator('[data-testid^="article-row-"]')
  await expect(landing).toBeVisible()
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'article-row-linux-commands')
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'article-row-ai-thinking')
  await expect(rows.nth(2)).toHaveAttribute('data-testid', 'article-row-mysql-basics')
  await expect(landing.locator('.card')).toHaveCount(0)
  await expect(landing.locator('.grid[class~="lg:grid-cols-3"]')).toHaveCount(0)

  await page.getByTestId('blog-category-ai').click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByTestId('article-row-ai-thinking')).toBeVisible()
})

const articles = [
  { slug: 'mysql-basics', heading: 'MySQL基础教程', body: '创建数据库' },
  { slug: 'ai-thinking', heading: '关于AI的思考', body: 'AI的发展趋势' },
  { slug: 'linux-commands', heading: 'Linux常用命令', body: '文件操作' },
] as const

for (const article of articles) {
  test(`${article.slug} renders its Content body`, async ({ page }) => {
    // Given an existing Content article
    // When the reader opens its default-locale route
    await page.goto(`/blog/${article.slug}`)

    // Then the route renders the queried Markdown body
    const detail = page.getByTestId('blog-detail')
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('heading', { level: 1, name: article.heading })).toBeVisible()
    await expect(detail).toContainText(article.body)
    await expect(page.getByTestId('article-back-link')).toHaveAttribute('href', '/blog')
  })
}

test('unknown blog slug returns HTTP 404', async ({ request }) => {
  // Given a slug absent from the Content collection
  // When the route is requested directly
  const response = await request.get('/blog/not-a-real-article')

  // Then Nuxt returns the explicit not-found response
  expect(response.status()).toBe(404)
})

test('Japanese article navigation keeps every internal link in the current locale', async ({ page }) => {
  // Given the Japanese route for an existing article
  // When the reader opens the article detail
  await page.goto('/ja/blog/linux-commands')

  // Then Content lookup is canonical while navigation remains Japanese-localized
  const detail = page.getByTestId('blog-detail')
  await expect(detail).toContainText('文件操作')
  await expect(page.getByTestId('article-back-link')).toHaveAttribute('href', '/ja/blog')

  const surroundingLinks = page.locator('[data-testid="article-prev-link"], [data-testid="article-next-link"]')
  await expect(surroundingLinks).toHaveCount(2)
  for (const link of await surroundingLinks.all()) {
    await expect(link).toHaveAttribute('href', /^\/ja\/blog\//)
  }
})
