import { describe, expect, it } from 'vitest'
import { renderPaperTaskReaderMarkdown } from '../../app/utils/paper-task-markdown'

const ASSET_URL = '/api/prototype/paper-task/123e4567-e89b-12d3-a456-426614174000/assets/asset-abc'
const resolveAsset = (assetId: string): string | null => assetId === 'asset-abc' ? ASSET_URL : null

describe('paper-task reader Markdown rendering', () => {
  it('extracts one article title and indexes only real article headings', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '# 可信检索：从证据片段到完整阅读\n\n引言。\n\n## 1 引言\n\n正文。\n\n### 1.1 研究问题\n\n细节。',
      resolveAsset,
    )

    expect(rendered.title).toBe('可信检索：从证据片段到完整阅读')
    expect(rendered.headings).toEqual([
      { id: '1-引言', text: '1 引言', depth: 2 },
      { id: '11-研究问题', text: '1.1 研究问题', depth: 3 },
    ])
    expect(rendered.html).toBe(
      '<p>引言。</p><h2 id="1-引言">1 引言</h2><p>正文。</p>'
        + '<h3 id="11-研究问题">1.1 研究问题</h3><p>细节。</p>',
    )
    expect(rendered.html).not.toContain('<h1')
  })

  it('keeps later h1 content as a second-level section so the page has one h1 title', () => {
    const rendered = renderPaperTaskReaderMarkdown('# 标题\n\n# 另一节\n\n内容。', resolveAsset)

    expect(rendered.title).toBe('标题')
    expect(rendered.html).toBe('<h2 id="另一节">另一节</h2><p>内容。</p>')
    expect(rendered.headings).toEqual([{ id: '另一节', text: '另一节', depth: 2 }])
  })

  it('deduplicates generated heading ids without inventing headings', () => {
    const rendered = renderPaperTaskReaderMarkdown('## 方法\n\n## 方法\n\n## 方法', resolveAsset)

    expect(rendered.headings.map((heading) => heading.id)).toEqual(['方法', '方法-1', '方法-2'])
    expect(rendered.html).toContain('<h2 id="方法-1">方法</h2>')
  })

  it('renders only a task-owned controlled image and keeps other image targets inert', () => {
    expect(renderPaperTaskReaderMarkdown('![表1](asset:asset-abc)', resolveAsset).html)
      .toBe(`<p><img src="${ASSET_URL}" alt="表1" loading="lazy" decoding="async"></p>`)
    expect(renderPaperTaskReaderMarkdown('![远程](https://example.com/a.png)', resolveAsset).html)
      .toBe('<p>远程</p>')
    expect(renderPaperTaskReaderMarkdown('![越界](asset:../../original.pdf)', resolveAsset).html)
      .toBe('<p>越界</p>')
    expect(renderPaperTaskReaderMarkdown('![外来](asset:asset-other)', resolveAsset).html)
      .toBe('<p>外来</p>')
  })

  it('keeps raw HTML, MDC syntax, and executable links inert', () => {
    const html = renderPaperTaskReaderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n::dangerous[prop]',
      resolveAsset,
    ).html

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('::dangerous[prop]')
  })

  it('drops unsafe link targets but keeps safe external and hash links', () => {
    expect(renderPaperTaskReaderMarkdown('[点我](javascript:alert(1))', resolveAsset).html)
      .toBe('<p>点我</p>')
    expect(renderPaperTaskReaderMarkdown('[数据](data:text/html,<script>alert(1)</script>)', resolveAsset).html)
      .toBe('<p>数据</p>')
    expect(renderPaperTaskReaderMarkdown('[原文](https://example.com/paper)', resolveAsset).html)
      .toBe('<p><a href="https://example.com/paper" rel="noopener noreferrer">原文</a></p>')
    expect(renderPaperTaskReaderMarkdown('[摘要](#摘要)', resolveAsset).html)
      .toBe('<p><a href="#%E6%91%98%E8%A6%81" rel="noopener noreferrer">摘要</a></p>')
  })

  it('renders a Markdown table in a horizontal-scroll wrapper without copied attributes', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '| 条件 | 数值 |\n| :--- | ---: |\n| 基础 | 42 |',
      resolveAsset,
    )

    expect(rendered.html).toContain('<div class="paper-task-reader__table"><table>')
    expect(rendered.html).toContain('<th>条件</th>')
    expect(rendered.html).toContain('<td>42</td>')
    expect(rendered.html).not.toContain('style=')
    expect(rendered.html).not.toContain('align=')
  })

  it('renders inline and block math as inert visible text, never executable markup', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '损失 $L = L_e + \\lambda L_c$ 保持一致。\n\n$$\\sum_{i=1}^{N} x_i$$\n\n$a < b$',
      resolveAsset,
    )

    expect(rendered.html).toContain('<span class="paper-task-reader__math" role="math">L = L_e + \\lambda L_c</span>')
    expect(rendered.html).toContain('<span class="paper-task-reader__math paper-task-reader__math--block" role="math">\\sum_{i=1}^{N} x_i</span>')
    expect(rendered.html).toContain('<span class="paper-task-reader__math" role="math">a &lt; b</span>')
    expect(rendered.html).not.toContain('<script')
  })

  it('does not treat prices without a closing delimiter as math', () => {
    expect(renderPaperTaskReaderMarkdown('费用 $5 与 $10。', resolveAsset).html)
      .toBe('<p>费用 $5 与 $10。</p>')
  })

  it('keeps dollar signs inside inline code literal', () => {
    expect(renderPaperTaskReaderMarkdown('`$5$`', resolveAsset).html)
      .toBe('<p><code>$5$</code></p>')
  })
})
