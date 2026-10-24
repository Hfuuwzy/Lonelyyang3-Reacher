import { describe, expect, it } from 'vitest'
import { buildPaperTaskReaderToc } from '../../app/utils/paper-task-reader-toc'

describe('paper-task reader table of contents', () => {
  it('nests each real h3 beneath its current h2 without replacing the Markdown ids', () => {
    const toc = buildPaperTaskReaderToc([
      { id: '背景', text: '背景', depth: 2 },
      { id: '原始证据', text: '原始证据', depth: 3 },
      { id: '对照研究', text: '对照研究', depth: 3 },
      { id: '局限', text: '局限', depth: 2 },
    ])

    expect(toc).toEqual([
      {
        id: '背景', text: '背景', depth: 2,
        children: [
          { id: '原始证据', text: '原始证据', depth: 3, children: [] },
          { id: '对照研究', text: '对照研究', depth: 3, children: [] },
        ],
      },
      { id: '局限', text: '局限', depth: 2, children: [] },
    ])
  })

  it('does not invent or normalize heading identifiers', () => {
    expect(buildPaperTaskReaderToc([{ id: 'a-1', text: 'A 1', depth: 2 }])[0]?.id).toBe('a-1')
  })
})
