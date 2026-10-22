import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

// Local-only controlled QA for the paper-review workbench (issue #27).
// Both cases fulfill the SSE endpoint locally via page.route and never reach a
// real provider. The base URL is a reserved .invalid host and the API key is a
// dummy literal.
const FIXTURE_PDF = resolve(process.cwd(), 'tests/fixtures/paper-review-sample.pdf')

const PROVIDER = 'fixture-provider'
const BASE_URL = 'https://provider.invalid/v1'
const MODEL = 'fixture-model'
const DUMMY_KEY = 'dummy-test-key'

// Fixture-grounded report: all five section kinds, each with one finding whose
// source heading/reader page/quote all come from the generator lines.
const SUCCESS_REPORT = {
  status: 'incomplete',
  provider: PROVIDER,
  model: MODEL,
  sections: [
    {
      kind: 'claims',
      title: '主要论断',
      findings: [
        {
          statement: '论文以印刷布局保留为目标呈现 PDF 文本',
          source: {
            heading: '1 Introduction',
            readerPage: 1,
            quote: 'Portable Document Format files preserve layout for print.',
          },
        },
      ],
    },
    {
      kind: 'methods',
      title: '方法',
      findings: [
        {
          statement: '论文用校准计时器测量响应延迟',
          source: {
            heading: '2 Methods',
            readerPage: 2,
            quote: 'We measured response latency with a calibrated timer.',
          },
        },
      ],
    },
    {
      kind: 'experiments',
      title: '实验',
      findings: [
        {
          statement: '调优后准确率从 71.2% 提升至 92.4%',
          source: {
            heading: '3 Results',
            readerPage: 3,
            quote: 'Accuracy improved from 71.2% to 92.4% after tuning.',
          },
        },
      ],
    },
    {
      kind: 'evidence',
      title: '证据',
      findings: [
        {
          statement: '快速褐狐例句作为排版样例',
          source: {
            heading: '1 Introduction',
            readerPage: 1,
            quote: 'The quick brown fox jumps over the lazy dog.',
          },
        },
      ],
    },
    {
      kind: 'criticism',
      title: '批评',
      findings: [
        {
          statement: '较短的引文跨越了句子边界，核验时需注意',
          source: {
            heading: '3 Results',
            readerPage: 3,
            quote: 'A shorter quote spans the sentence boundary.',
          },
        },
      ],
    },
  ],
  gaps: [{ section: 'full-translation', reason: '完整双语全文翻译尚未纳入本次审阅范围' }],
  missingScope: ['full-translation'],
}

const SUCCESS_SSE = [
  { type: 'stage', stage: 'validating' },
  { type: 'stage', stage: 'extracting' },
  { type: 'stage', stage: 'analyzing' },
  { type: 'stage', stage: 'verifying' },
  { type: 'report', report: SUCCESS_REPORT },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join('')

const ERROR_SSE = [
  { type: 'stage', stage: 'validating' },
  { type: 'stage', stage: 'extracting' },
  {
    type: 'error',
    stage: 'analyzing',
    code: 'MODEL_UNAVAILABLE',
    message: '提供方模型端点返回 5xx，无法继续分析。',
  },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join('')

// Controlled-response delay keeps the running/progress UI observable before the
// terminal SSE event lands. Bounded to stay deterministic.
const ROUTE_DELAY_MS = 200

async function prepareForm(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/prototype/paper-review')
  await expect(page.getByTestId('paper-review-form')).toBeVisible()

  const disclosure = page.locator('.paper-review-disclosure')
  await page.fill('#paper-review-provider', PROVIDER)
  await expect(disclosure).toContainText(PROVIDER)
  await page.fill('#paper-review-base-url', BASE_URL)
  await expect(disclosure).toContainText(BASE_URL)

  await page.selectOption('#paper-review-protocol', 'openai-completions')
  await page.fill('#paper-review-model', MODEL)
  await page.setInputFiles('#paper-review-pdf', FIXTURE_PDF)
  await page.fill('#paper-review-api-key', DUMMY_KEY)
}

async function expectKeyNotPersisted(page: import('@playwright/test').Page): Promise<void> {
  const keyWasPersisted = await page.evaluate((secret) => {
    const storedValues = [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).flatMap((key) => [key, storage.getItem(key) ?? '']),
    )
    return storedValues.some((value) => value.includes(secret)) || document.cookie.includes(secret)
  }, DUMMY_KEY)
  expect(keyWasPersisted).toBe(false)
}

test('controlled success renders a five-section incomplete report with source locations', async ({
  page,
}, testInfo) => {
  let requestCount = 0
  await page.route('**/api/prototype/paper-review', async (route) => {
    requestCount += 1
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    await new Promise((resolve) => setTimeout(resolve, ROUTE_DELAY_MS))
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: SUCCESS_SSE,
    })
  })

  await prepareForm(page)

  await page.getByRole('button', { name: '提交审阅' }).click()

  // The progress section is visible while the controlled response is pending.
  await expect(page.getByTestId('paper-review-progress')).toBeVisible()

  const report = page.getByTestId('paper-review-report')
  await expect(report).toBeVisible()

  await expect(report.locator('.paper-review-section')).toHaveCount(5)
  await expect(report.locator('.paper-review-report__incomplete')).toContainText('full-translation')
  await expect(report.locator('.paper-review-gaps')).toBeVisible()

  // One fixture-grounded finding: structural heading, 1-based reader page, quote.
  const sources = report.locator('.paper-review-finding__source')
  const quotes = report.locator('.paper-review-finding__quote')
  await expect(sources).toHaveCount(5)
  await expect(quotes).toHaveCount(5)
  const expectedSources = [
    ['1 Introduction', '阅读页 1'],
    ['2 Methods', '阅读页 2'],
    ['3 Results', '阅读页 3'],
    ['1 Introduction', '阅读页 1'],
    ['3 Results', '阅读页 3'],
  ] as const
  for (const [index, [heading, readerPage]] of expectedSources.entries()) {
    await expect(sources.nth(index)).toContainText(heading)
    await expect(sources.nth(index)).toContainText(readerPage)
  }
  await expect(quotes.nth(0)).toContainText('Portable Document Format files preserve layout for print.')
  await expect(quotes.nth(1)).toContainText('We measured response latency with a calibrated timer.')
  await expect(quotes.nth(2)).toContainText('Accuracy improved from 71.2% to 92.4% after tuning.')
  await expect(quotes.nth(3)).toContainText('The quick brown fox jumps over the lazy dog.')
  await expect(quotes.nth(4)).toContainText('A shorter quote spans the sentence boundary.')

  // The key is cleared from the bound input and never persisted to browser storage.
  await expect(page.locator('#paper-review-api-key')).toHaveValue('')
  await expectKeyNotPersisted(page)

  expect(requestCount).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('paper-review-success.png'), fullPage: true })
})

test('controlled model failure does not auto-retry and resubmission with a re-entered key succeeds', async ({
  page,
  context,
}, testInfo) => {
  // Seed a harmless cookie; with credentials:'omit' the routed request must not
  // carry it.
  await context.addCookies([
    { name: 'harmless-test-cookie', value: 'present', url: 'http://localhost:3000' },
  ])

  let requestCount = 0
  let cookieWithSeedSent = false
  await page.route('**/api/prototype/paper-review', async (route) => {
    requestCount += 1
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    const cookie = route.request().headers()['cookie']
    if (cookie?.includes('harmless-test-cookie')) {
      cookieWithSeedSent = true
    }
    await new Promise((resolve) => setTimeout(resolve, ROUTE_DELAY_MS))
    const body = requestCount === 1 ? ERROR_SSE : SUCCESS_SSE
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body,
    })
  })

  await prepareForm(page)

  await page.getByRole('button', { name: '提交审阅' }).click()

  await expect(page.getByTestId('paper-review-progress')).toBeVisible()

  const error = page.getByTestId('paper-review-error')
  await expect(error).toBeVisible()
  await expect(error).toHaveAttribute('role', 'alert')
  await expect(error).toContainText('不会自动重试')

  await expect(page.locator('#paper-review-api-key')).toHaveValue('')

  // No automatic retry: after a bounded wait the request count is still one.
  await page.waitForTimeout(700)
  expect(requestCount).toBe(1)
  expect(cookieWithSeedSent).toBe(false)

  await expectKeyNotPersisted(page)

  await page.screenshot({ path: testInfo.outputPath('paper-review-error.png'), fullPage: true })

  // User re-enters the key and explicitly clicks submit -> a new successful request.
  await page.fill('#paper-review-api-key', DUMMY_KEY)
  await page.getByRole('button', { name: '提交审阅' }).click()
  await expect(page.getByTestId('paper-review-progress')).toBeVisible()

  const report = page.getByTestId('paper-review-report')
  await expect(report).toBeVisible()
  await expect(report.locator('.paper-review-section')).toHaveCount(5)
  await expect(page.locator('#paper-review-api-key')).toHaveValue('')
  expect(requestCount).toBe(2)
})
