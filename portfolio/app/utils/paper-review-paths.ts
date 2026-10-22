/**
 * Absolute reader-route paths for the paper-review nested routes. Pure and
 * framework-free so the router resolution contract is unit-testable.
 *
 * Child routes are `/prototype/paper-review/report` and
 * `/prototype/paper-review/translation` (Nuxt nested routing under the parent
 * `paper-review.vue`); relative links like `./report` resolve against the
 * *current* route's directory and would escape the parent — these absolute
 * paths are what the pages must use (wrapped by the i18n-aware composable in
 * `../composables/paper-review-links.ts`).
 */

export type PaperReviewReaderKind = 'workbench' | 'report' | 'translation'

export const PAPER_REVIEW_WORKBENCH_PATH = '/prototype/paper-review'
export const PAPER_REVIEW_REPORT_PATH = '/prototype/paper-review/report'
export const PAPER_REVIEW_TRANSLATION_PATH = '/prototype/paper-review/translation'

export function paperReviewReaderPath(kind: PaperReviewReaderKind): string {
  switch (kind) {
    case 'workbench':
      return PAPER_REVIEW_WORKBENCH_PATH
    case 'report':
      return PAPER_REVIEW_REPORT_PATH
    case 'translation':
      return PAPER_REVIEW_TRANSLATION_PATH
  }
}