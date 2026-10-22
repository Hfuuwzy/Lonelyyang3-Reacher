/**
 * Locale-aware absolute links between the paper-review workbench and its
 * reader routes. The pages must never navigate with relative `to="./report"`
 * style links — Vue Router resolves those against the current route's
 * directory (from `/prototype/paper-review` that lands on
 * `/prototype/report`), so these links are built from the absolute paths in
 * `../utils/paper-review-paths.ts` and passed through i18n's locale path.
 */

import { useLocalePath } from '#imports'
import {
  PAPER_REVIEW_REPORT_PATH,
  PAPER_REVIEW_TRANSLATION_PATH,
  PAPER_REVIEW_WORKBENCH_PATH,
} from '../utils/paper-review-paths'

export interface PaperReviewReaderLinks {
  readonly workbench: string
  readonly report: string
  readonly translation: string
}

export function usePaperReviewReaderLinks(): PaperReviewReaderLinks {
  const localePath = useLocalePath()
  return {
    workbench: localePath(PAPER_REVIEW_WORKBENCH_PATH),
    report: localePath(PAPER_REVIEW_REPORT_PATH),
    translation: localePath(PAPER_REVIEW_TRANSLATION_PATH),
  }
}