import type { PaperExtractionResult } from '../../server/utils/paper-review/pdf'
import type { PaperTaskSourceRecord, PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'

export function preparedExtractionFixture(extraction: PaperExtractionResult): PaperTaskSourceResult {
  if (!extraction.success) {
    const code = extraction.error.code === 'no-text' ? 'read-failed' : extraction.error.code
    return { success: false, error: { code } }
  }
  const records: PaperTaskSourceRecord[] = []
  let sectionId: string | null = null
  let context = ''
  for (const page of extraction.pages) {
    for (const text of page.text.split('\n').filter(Boolean)) {
      const id = `p${page.readerPage}-r${records.length}`
      const heading = page.headings.includes(text)
      if (heading) {
        sectionId = id
        context = text
      }
      records.push({
        id, order: records.length, kind: heading ? 'heading' : 'body', text, state: 'present',
        page: page.readerPage, bbox: [0, 0, 1, 1], sectionId, context, links: [],
      })
      if (!heading) context = text
    }
  }
  return { success: true, source: { status: 'complete', pageCount: extraction.pageCount, records }, assets: [] }
}
