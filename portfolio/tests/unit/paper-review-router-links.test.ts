import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import {
  PAPER_REVIEW_REPORT_PATH,
  PAPER_REVIEW_TRANSLATION_PATH,
  PAPER_REVIEW_WORKBENCH_PATH,
  paperReviewReaderPath,
} from '../../app/utils/paper-review-paths'

const ROUTES: readonly RouteRecordRaw[] = [
  {
    path: '/prototype/paper-review',
    component: { template: '<div />' },
    children: [
      { path: '', component: { template: '<div />' } },
      { path: 'report', component: { template: '<div />' } },
      { path: 'translation', component: { template: '<div />' } },
    ],
  },
]

async function workbenchRouter() {
  const router = createRouter({
    history: createMemoryHistory('/prototype/paper-review'),
    routes: [...ROUTES],
  })
  // vue-router 5 does not self-start the initial navigation in the
  // constructor, so isReady() would never resolve without an explicit push.
  await router.push('/prototype/paper-review')
  await router.isReady()
  return router
}

describe('paper-review reader paths', () => {
  it('exposes the absolute child-route paths', () => {
    expect(paperReviewReaderPath('workbench')).toBe('/prototype/paper-review')
    expect(paperReviewReaderPath('report')).toBe('/prototype/paper-review/report')
    expect(paperReviewReaderPath('translation')).toBe('/prototype/paper-review/translation')
    expect(PAPER_REVIEW_WORKBENCH_PATH).toBe('/prototype/paper-review')
    expect(PAPER_REVIEW_REPORT_PATH).toBe('/prototype/paper-review/report')
    expect(PAPER_REVIEW_TRANSLATION_PATH).toBe('/prototype/paper-review/translation')
  })
})

describe('router resolution contract (guards the absolute-link requirement)', () => {
  it('relative ./report from the workbench escapes the parent route (the bug the absolute paths replace)', async () => {
    const router = await workbenchRouter()
    const escaped = router.resolve({ path: './report' }, router.currentRoute.value)
    expect(escaped.fullPath).toBe('/prototype/report')
    expect(escaped.matched.some((record) => record.path === '/prototype/paper-review/report')).toBe(false)
  })

  it('absolute report/translation paths resolve to the nested reader routes', async () => {
    const router = await workbenchRouter()
    const report = router.resolve(PAPER_REVIEW_REPORT_PATH)
    expect(report.fullPath).toBe('/prototype/paper-review/report')
    expect(report.matched.some((record) => record.path === '/prototype/paper-review/report')).toBe(true)
    const translation = router.resolve(PAPER_REVIEW_TRANSLATION_PATH)
    expect(translation.fullPath).toBe('/prototype/paper-review/translation')
    expect(translation.matched.some((record) => record.path === '/prototype/paper-review/translation')).toBe(true)
    const workbench = router.resolve(PAPER_REVIEW_WORKBENCH_PATH)
    expect(workbench.fullPath).toBe('/prototype/paper-review')
  })

  it('the workbench back-link from the report route resolves inside the parent', async () => {
    const router = await workbenchRouter()
    await router.push('/prototype/paper-review/report')
    const back = router.resolve({ path: './' }, router.currentRoute.value)
    expect(back.fullPath).toBe('/prototype/paper-review/')
    expect(back.matched.some((record) => record.path === '/prototype/paper-review')).toBe(true)
  })
})