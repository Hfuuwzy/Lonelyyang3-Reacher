import type { PaperTaskReaderFormatState } from './paper-task-reader-contract'

type SavedPage = PaperTaskReaderFormatState['pages'][number]

export interface PaperTaskInspectionPageDraft {
  readonly page: number
  status: SavedPage['status'] | ''
  expected: string
  observed: string
  evidence: string
}

/** New page conclusions fail closed; previously saved checks stay attached to the same page. */
export function createPaperTaskInspectionDrafts(
  pageCount: number,
  savedPages: readonly SavedPage[],
): PaperTaskInspectionPageDraft[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1
    const prior = savedPages.find((entry) => entry.page === page)
    return {
      page,
      status: prior?.status ?? '',
      expected: prior?.expected ?? '',
      observed: prior?.observed ?? '',
      evidence: prior?.evidence ?? '',
    }
  })
}
