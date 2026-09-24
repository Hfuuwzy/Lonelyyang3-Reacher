import { expect, test } from '@playwright/test'

const completeHomeSeams = [
  'home-brand',
  'home-visual-info',
  'home-artwork-loading',
  'home-artwork-panel',
  'hero-main-image',
  'home-paper-transition',
] as const

test('homepage exposes the approved semantic regions and character-level brand', async ({ page }) => {
  // Given the homepage is rendered with its existing content
  await page.goto('/')

  // When the stable homepage regions and brand are inspected
  const visual = page.getByTestId('home-visual')
  const stage = visual.getByTestId('home-visual-stage')
  const brand = page.getByTestId('home-brand')
  const characters = brand.getByTestId('home-brand-character')

  // Then semantic order is visual information, final artwork, paper, and INFORMATION
  await expect(stage.locator(':scope > [data-testid="home-visual-info"]')).toHaveCount(1)
  await expect(stage.locator(':scope > [data-testid="home-artwork-panel"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="home-visual"] + [data-testid="home-paper-transition"] + #information')).toHaveCount(1)
  expect(await stage.getByTestId('home-visual-info').evaluate((info, panel) =>
    Boolean(info.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING),
  await stage.getByTestId('home-artwork-panel').elementHandle())).toBe(true)

  // Then MyWorks remains one accessible name backed by seven hidden visual characters
  await expect(brand).toHaveAccessibleName('MyWorks')
  await expect(characters).toHaveCount(7)
  expect(await characters.evaluateAll(elements =>
    elements.every(element => element.getAttribute('aria-hidden') === 'true'),
  )).toBe(true)
})

test('first visit follows brand artwork handoff and settled timing', async ({ page }) => {
  // Given this browser session has not presented the homepage intro
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => sessionStorage.clear())

  // When the homepage begins its first-visit sequence
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const visual = page.getByTestId('home-visual')
  const characters = page.getByTestId('home-brand-character')
  const loading = page.getByTestId('home-artwork-loading')
  await loading.evaluate((element) => {
    const recordDrop = (event: Event): void => {
      if (!(event instanceof TransitionEvent) || event.propertyName !== 'transform')
        return
      element.setAttribute('data-drop-transition-started', 'true')
      element.removeEventListener('transitionrun', recordDrop)
    }
    element.addEventListener('transitionrun', recordDrop)
  })

  // Then all approved DOM seams exist throughout the sequence
  for (const testId of completeHomeSeams)
    await expect(page.getByTestId(testId)).toHaveCount(1)

  // Then the character animation uses the approved duration and stagger
  await expect(visual).toHaveAttribute('data-intro-mode', 'first')
  await expect(visual).toHaveAttribute('data-intro-state', 'brand')
  const characterMotion = await characters.evaluateAll(elements => elements.map((element) => ({
    duration: Number.parseFloat(getComputedStyle(element).animationDuration),
    delay: Number.parseFloat(getComputedStyle(element).animationDelay),
  })))
  expect(characterMotion.map(motion => motion.duration)).toEqual(Array.from({ length: 7 }, () => 0.7))
  expect(characterMotion.map(motion => motion.delay)).toEqual([0, 0.16, 0.32, 0.48, 0.64, 0.96, 1.12])

  // Then observable state and transition evidence prove the 2s/3s/4.5s/6.5s sequence
  await expect(visual).toHaveAttribute('data-intro-state', 'artwork', { timeout: 2_500 })
  await expect(loading).toHaveAttribute('data-drop-transition-started', 'true', { timeout: 1_500 })
  await expect(visual).toHaveAttribute('data-intro-state', 'handoff', { timeout: 2_000 })
  await expect(visual).toHaveAttribute('data-intro-state', 'settled', { timeout: 2_500 })
})

test('return and reduced modes preserve the complete final DOM', async ({ page }) => {
  // Given the homepage intro marker is established in this browser session
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')

  // When the homepage returns in the same session
  await page.reload({ waitUntil: 'domcontentloaded' })
  const visual = page.getByTestId('home-visual')

  // Then the compressed sequence reaches the same settled DOM by 1200ms
  await expect(visual).toHaveAttribute('data-intro-mode', 'return')
  await expect(visual).toHaveAttribute('data-intro-state', 'brand')
  await expect(visual).toHaveAttribute('data-intro-state', 'artwork', { timeout: 500 })
  await expect(visual).toHaveAttribute('data-intro-state', 'settled', { timeout: 1_000 })
  for (const testId of completeHomeSeams)
    await expect(page.getByTestId(testId)).toHaveCount(1)
  const returnCharactersSettled = await page.getByTestId('home-brand-character').evaluateAll(elements =>
    elements.every((element) => {
      const style = getComputedStyle(element)
      return style.opacity === '1' && (style.filter === 'none' || style.filter === 'blur(0px)')
    }),
  )
  expect(returnCharactersSettled).toBe(true)

  // Given the visitor now requests reduced motion
  await page.emulateMedia({ reducedMotion: 'reduce' })

  // When the homepage reloads under that preference
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Then the same DOM settles with approximately 1ms motion
  await expect(visual).toHaveAttribute('data-intro-mode', 'reduced')
  await expect(visual).toHaveAttribute('data-intro-state', 'settled')
  for (const testId of completeHomeSeams)
    await expect(page.getByTestId(testId)).toHaveCount(1)
  const reducedDurations = await page.locator('[data-testid="home-brand-character"], [data-testid="home-artwork-loading"]').evaluateAll(
    elements => elements.map(element => Math.max(
      Number.parseFloat(getComputedStyle(element).animationDuration),
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    )),
  )
  expect(reducedDurations.every(duration => Math.abs(duration - 0.001) <= 0.001)).toBe(true)
})

test('loading and final artwork use separate fixed and intrinsic normal-flow seams', async ({ page }) => {
  // Given the desktop homepage is settled
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  // When both artwork layers and their computed geometry are inspected
  const loading = page.getByTestId('home-artwork-loading')
  const panel = page.getByTestId('home-artwork-panel')
  const image = panel.getByTestId('hero-main-image')
  await expect(image).toHaveAttribute('width', '1920')
  await expect(image).toHaveAttribute('height', '2566')
  const geometry = await page.evaluate(() => {
    const loadingElement = document.querySelector('[data-testid="home-artwork-loading"]')
    const panelElement = document.querySelector('[data-testid="home-artwork-panel"]')
    const imageElement = document.querySelector('[data-testid="hero-main-image"]')
    if (!loadingElement || !panelElement || !imageElement)
      return null
    const loadingStyle = getComputedStyle(loadingElement)
    const panelStyle = getComputedStyle(panelElement)
    const imageStyle = getComputedStyle(imageElement)
    const panelRect = panelElement.getBoundingClientRect()
    const imageRect = imageElement.getBoundingClientRect()
    return {
      loadingPosition: loadingStyle.position,
      imagePosition: imageStyle.position,
      objectFit: imageStyle.objectFit,
      panelOverflow: `${panelStyle.overflowX} ${panelStyle.overflowY}`,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
    }
  })

  // Then loading is fixed while the uncropped final image fills normal flow intrinsically
  expect(geometry).not.toBeNull()
  expect(geometry?.loadingPosition).toBe('fixed')
  expect(['absolute', 'fixed']).not.toContain(geometry?.imagePosition)
  expect(geometry?.objectFit).not.toBe('cover')
  expect(geometry?.panelOverflow).not.toContain('hidden')
  expect(geometry?.imageWidth).toBeCloseTo(geometry?.panelWidth ?? 0, 0)
  expect(geometry?.imageHeight).toBeCloseTo((geometry?.imageWidth ?? 0) * 2566 / 1920, 0)
  expect(geometry?.panelHeight).toBeCloseTo(geometry?.imageHeight ?? 0, 0)
  await expect(loading).toHaveCount(1)
})

test('paper begins at the complete artwork bottom rather than the first viewport', async ({ page }) => {
  // Given the intrinsic artwork and paper transition are settled
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  // When their document geometry is measured
  const artworkBox = await page.getByTestId('home-artwork-panel').boundingBox()
  const paperBox = await page.getByTestId('home-paper-transition').boundingBox()
  const diagonal = await page.evaluate(() => innerWidth * Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--home-paper-diagonal'),
  ) / 100)

  // Then only the intentional diagonal overlaps the complete image bottom
  expect(artworkBox).not.toBeNull()
  expect(paperBox).not.toBeNull()
  expect(paperBox?.y).toBeGreaterThan(800)
  expect(paperBox?.y ?? 0).toBeGreaterThanOrEqual((artworkBox?.y ?? 0) + (artworkBox?.height ?? 0) - diagonal - 2)
  expect(paperBox?.y ?? 0).toBeLessThanOrEqual((artworkBox?.y ?? 0) + (artworkBox?.height ?? 0) + 2)
})

test('drawer anchors left of a stationary rail with one transparent close surface', async ({ page }) => {
  // Given the desktop rail and truthful GitHub target are rendered
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const rail = page.getByTestId('right-nav-rail')
  const menu = page.getByTestId('right-nav-menu-button')
  const github = page.getByTestId('right-nav-share-links').getByRole('link', { name: 'GitHub profile' })
  const railBefore = await rail.boundingBox()
  await expect(github).toHaveAttribute('href', 'https://github.com/Hfuuwzy')
  await expect(github).toHaveAttribute('target', '_blank')
  await expect(github).toHaveAttribute('rel', 'noopener noreferrer')

  // When the rail menu opens the drawer
  await menu.click()
  const drawer = page.getByTestId('right-nav-drawer')
  const overlay = page.getByTestId('right-nav-overlay')
  await expect(drawer).toBeVisible()
  await expect.poll(async () => {
    const [drawerRect, railRect] = await Promise.all([drawer.boundingBox(), rail.boundingBox()])
    return (drawerRect?.x ?? 0) + (drawerRect?.width ?? 0) - (railRect?.x ?? 0)
  }).toBeCloseTo(0, 0)
  const [railAfter, drawerBox, drawerMotion, overlayAlpha] = await Promise.all([
    rail.boundingBox(),
    drawer.boundingBox(),
    drawer.evaluate(element => ({
      duration: Number.parseFloat(getComputedStyle(element).transitionDuration),
      properties: getComputedStyle(element).transitionProperty.split(',').map(value => value.trim()),
    })),
    overlay.evaluate(element => {
      const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)
      return channels?.length === 4 ? Number.parseFloat(channels[3] ?? '1') : 1
    }),
  ])

  // Then the rail stays fixed and the transform/opacity drawer ends at its left edge
  expect(railAfter).toEqual(railBefore)
  expect(drawerBox?.x).toBeDefined()
  expect((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0)).toBeCloseTo(railAfter?.x ?? 0, 0)
  expect(drawerMotion.duration).toBeCloseTo(0.7, 2)
  expect(drawerMotion.properties).toEqual(expect.arrayContaining(['transform', 'opacity']))
  expect(overlayAlpha).toBe(0)
  await expect(page.getByTestId('right-nav-close')).toHaveCount(0)
  await expect(rail.getByTestId('right-nav-close-icon')).toHaveCount(1)
  for (const target of [menu, github]) {
    const box = await target.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }

  // When the transparent click-away target activates its close path
  await overlay.click({ position: { x: 8, y: 8 } })

  // Then the drawer closes without a visible dimmer
  await expect(drawer).toHaveCount(0)

  // When the drawer reopens and Escape activates the remaining close path
  await menu.click()
  await expect(page.getByTestId('right-nav-drawer')).toBeVisible()
  await page.keyboard.press('Escape')

  // Then the drawer closes
  await expect(drawer).toHaveCount(0)
})

test('homepage uses the complete Mincho stack and intrinsic ratio without overflow', async ({ page }) => {
  // Given each DESIGN.md acceptance viewport is available
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const viewports = [{ width: 1280, height: 800 }, { width: 768, height: 844 }, { width: 375, height: 667 }] as const

  for (const viewport of viewports) {
    // When the homepage resolves at the viewport
    await page.setViewportSize(viewport)
    await page.goto('/')
    const visual = page.getByTestId('home-visual')
    const panel = page.getByTestId('home-artwork-panel')
    const image = page.getByTestId('hero-main-image')
    const [panelBox, imageBox] = await Promise.all([panel.boundingBox(), image.boundingBox()])

    // Then Mincho typography, intrinsic artwork, and document width honor the contract
    const fontFamily = await visual.evaluate(element => getComputedStyle(element).fontFamily)
    expect(fontFamily).toContain('YakuHanMP')
    expect(fontFamily).toContain('Yu Mincho')
    expect(fontFamily).toContain('Noto Serif SC')
    expect(imageBox?.width).toBeCloseTo(panelBox?.width ?? 0, 0)
    expect(imageBox?.height).toBeCloseTo((imageBox?.width ?? 0) * 2566 / 1920, 0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})
