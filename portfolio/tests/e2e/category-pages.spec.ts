import { expect, test } from '@playwright/test'

const categoryPages = [
  { path: '/projects', key: 'projects', content: ['MyWorks', 'More work in progress', 'Vue', 'TypeScript', 'Nuxt', 'Research', 'Prototype'] },
  { path: '/movies', key: 'movies', content: ['推荐电影列表', '推荐剧集列表'] },
  { path: '/anime', key: 'anime', content: ['每月新番推荐', '经典动漫回顾'] },
  { path: '/music', key: 'music', content: ['推荐歌单'] },
  { path: '/tools', key: 'tools', content: ['开发工具推荐', '学习资源汇总'] },
  { path: '/life', key: 'life', content: ['生活随笔'] },
  { path: '/notes', key: 'notes', content: ['技术笔记汇总'] },
] as const

test.describe('preserved category pages', () => {
  for (const category of categoryPages) {
    test(`${category.path} uses the paper category landing`, async ({ page }) => {
      await page.goto(category.path)

      const landing = page.getByTestId(`category-landing-${category.key}`)
      await expect(landing).toBeVisible()
      await expect(page.getByTestId(`category-list-${category.key}`)).toBeVisible()

      for (const content of category.content) {
        await expect(landing).toContainText(content)
      }

      await expect(landing.locator('.card')).toHaveCount(0)
      await expect(landing.locator('.grid[class~="lg:grid-cols-3"]')).toHaveCount(0)
      await expect(landing).not.toContainText(/[🎬📺🎵🔧🌸📚🌐🚀]/u)
    })
  }
})

test('about uses the open paper profile composition', async ({ page }) => {
  await page.goto('/about')

  const about = page.getByTestId('category-landing-about')
  await expect(about).toBeVisible()
  await expect(about.getByTestId('about-visual')).toBeVisible()
  await expect(about.getByTestId('about-introduction')).toHaveCSS('writing-mode', 'vertical-rl')
  await expect(about.getByTestId('about-body')).toContainText('热爱技术')
  await expect(about.getByTestId('about-skills')).toContainText('Vue.js')
  await expect(about.getByTestId('about-experience')).toContainText('2025')
  await expect(about.getByTestId('about-links').locator('a')).toHaveCount(3)
  await expect(about.getByTestId('about-links').locator('svg')).toHaveCount(3)
  await expect(about.locator('.card')).toHaveCount(0)
  await expect(about).not.toContainText(/[👤🐙🐦📺💚🟢💙🟩🐍🐧🗄️📦🐳]/u)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
