import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderPaperTaskPdf } from '../../server/paper-task/document-render'

const MANUSCRIPT = '# 中文整稿\n\n这一段包含准确的证据说明。\n\n## 方法\n\n保留可编辑正文与原稿文字。\n\n| 项目 | 结果 |\n| --- | --- |\n| 样例 | 完整 |'

describe('paper-task document renderers', () => {
  it('renders a searchable PDF with every source text block and reports its page count', async () => {
    const artifact = await renderPaperTaskPdf(MANUSCRIPT, [])

    expect(artifact.bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(artifact.pageCount).toBeGreaterThan(0)
    expect(artifact.boundaryCheck.passed).toBe(true)
    expect(artifact.boundaryCheck.matchedBlocks).toEqual(artifact.boundaryCheck.sourceBlocks)
  })

  it('preserves every list paragraph and table cell, including an embedded controlled table image', async () => {
    const markdown = [
      '# 清单与表格',
      '',
      '- 清单第一段。',
      '',
      '  清单第二段也必须保留。',
      '',
      '5. 有序清单从第五项开始。',
      '',
      '插图前的文字。![段落插图](asset:asset-test)插图后的文字。',
      '',
      '| 图示 | 说明 |',
      '| --- | --- |',
      '| ![表格图示](asset:asset-test) | 表格中的说明文字 |',
    ].join('\n')
    const image = readFileSync(new URL('../../public/images/brand/site-icon.png', import.meta.url))
    const artifact = await renderPaperTaskPdf(markdown, [{ id: 'asset-test', bytes: image }])
    const loading = getDocument({ data: new Uint8Array(artifact.bytes), useSystemFonts: false })
    const pdf = await loading.promise
    try {
      const page = await pdf.getPage(1)
      const operators = await page.getOperatorList()
      const pageText = (await page.getTextContent()).items
        .flatMap((item) => 'str' in item && typeof item.str === 'string' ? [item.str] : [])
        .join(' ')

      expect(artifact.boundaryCheck.sourceBlocks).toBe(13)
      expect(artifact.boundaryCheck.matchedBlocks).toBe(13)
      expect(pageText).toContain('5.')
      expect(operators.fnArray).toContain(OPS.paintImageXObject)
    } finally {
      await loading.destroy()
    }
  })
})
