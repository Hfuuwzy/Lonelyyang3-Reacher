import { describe, expect, it } from 'vitest'
import { renderPaperTaskReaderMarkdown } from '../../app/utils/paper-task-markdown'

const ASSET_URL = '/api/prototype/paper-task/123e4567-e89b-12d3-a456-426614174000/assets/asset-abc'
const ORIGINAL_PDF_URL = '/api/prototype/paper-task/123e4567-e89b-12d3-a456-426614174000/pdf/original'
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

  it('reserves generated suffixes so a later explicit slug cannot collide', () => {
    const rendered = renderPaperTaskReaderMarkdown('## A\n\n## A\n\n## A-1', resolveAsset)

    expect(rendered.headings.map((heading) => heading.id)).toEqual(['a', 'a-1', 'a-1-1'])
  })

  it('renders only a task-owned controlled image and keeps other image targets inert', () => {
    expect(renderPaperTaskReaderMarkdown('![表1](asset:asset-abc)', resolveAsset).html)
      .toBe(`<p><img src="${ASSET_URL}" alt="表1" loading="lazy" decoding="async">`
        + `<a class="paper-task-reader__image-source" href="${ORIGINAL_PDF_URL}" target="_blank" rel="noopener noreferrer">`
        + '打开原论文 PDF 核对完整页面（当前配图为提取裁片）</a></p>')
    expect(renderPaperTaskReaderMarkdown(
      '![表1](asset:asset-abc)',
      () => '/api/prototype/paper-task/not-a-task-id/assets/asset-abc',
    ).html).not.toContain('paper-task-reader__image-source')
    expect(renderPaperTaskReaderMarkdown('![远程](https://example.com/a.png)', resolveAsset).html)
      .toBe('<p>远程</p>')
    expect(renderPaperTaskReaderMarkdown('![越界](asset:../../original.pdf)', resolveAsset).html)
      .toBe('<p>越界</p>')
    expect(renderPaperTaskReaderMarkdown('![外来](asset:asset-other)', resolveAsset).html)
      .toBe('<p>外来</p>')
  })

  it('keeps raw HTML, MDC syntax, and executable links inert', () => {
    const html = renderPaperTaskReaderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<widget>inert</widget>\n\n::dangerous[prop]',
      resolveAsset,
    ).html

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;widget&gt;inert&lt;/widget&gt;')
    expect(html).toContain('::dangerous[prop]')
  })

  it('renders balanced scholarly sup/sub tags and keeps nested text in reader headings', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '# Authors<sup>1,2</sup>\n\n**Mina**<sup>*1*,2</sup> and H<sub>2</sub>O\n\n## Affiliations<sup><sub>1</sub>,2</sup>',
      resolveAsset,
    )

    expect(rendered.title).toBe('Authors1,2')
    expect(rendered.html).toContain('<p><strong>Mina</strong><sup><em>1</em>,2</sup> and H<sub>2</sub>O</p>')
    expect(rendered.headings).toEqual([{ id: 'affiliations12', text: 'Affiliations1,2', depth: 2 }])
    expect(rendered.html).toContain('<h2 id="affiliations12">Affiliations<sup><sub>1</sub>,2</sup></h2>')
  })

  it('keeps attributed, unbalanced, and executable raw markup escaped', () => {
    const html = renderPaperTaskReaderMarkdown(
      '<sup class="unsafe" onclick="alert(1)">1</sup> and <sub>unclosed\n\n<script>alert(1)</script>',
      resolveAsset,
    ).html

    expect(html).toContain('&lt;sup class=&quot;unsafe&quot; onclick=&quot;alert(1)&quot;&gt;1&lt;/sup&gt;')
    expect(html).toContain('&lt;sub&gt;unclosed')
    expect(html).not.toContain('<sup class=')
    expect(html).not.toContain('<script')
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

  it('preserves GFM header and data-cell order while leaving alignment to the reader layout', () => {
    const html = renderPaperTaskReaderMarkdown(
      '| Dataset | F1 |\n| :--- | ---: |\n| Method A | 0.943 |',
      resolveAsset,
    ).html.replace(/>\s+</gu, '><')

    expect(html).toBe(
      '<div class="paper-task-reader__table"><table><thead><tr><th>Dataset</th><th>F1</th></tr></thead>'
      + '<tbody><tr><td>Method A</td><td>0.943</td></tr></tbody></table></div>',
    )
    expect(html).not.toContain('style=')
    expect(html).not.toContain('align=')
  })

  it('typesets inline and block math as accessible HTML and MathML', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '损失 $L = L_e + \\lambda L_c$ 保持一致。\n\n$$\\sum_{i=1}^{N} x_i$$\n\n$a < b$',
      resolveAsset,
    )

    expect(rendered.html).toContain('<span class="paper-task-reader__math" role="math"><span class="katex">')
    expect(rendered.html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"')
    expect(rendered.html).toContain('<annotation encoding="application/x-tex">L = L_e + \\lambda L_c</annotation>')
    expect(rendered.html).toContain('<span class="paper-task-reader__math paper-task-reader__math--block" role="math"><span class="katex-display">')
    expect(rendered.html).not.toContain('<script')
  })

  it('protects valid TeX from CommonMark emphasis before typesetting subscripts and equation tags', () => {
    const inlineTex = String.raw`\left(\alpha_i\right)_{k} + \left(\beta_j\right)_{k}`
    const tag = `${String.fromCharCode(92)}tag{9}`
    const displayTex = String.raw`\left(\alpha_i\right)_{k} + \left(\beta_j\right)_{k} = 1 ${tag}`
    const rendered = renderPaperTaskReaderMarkdown(
      `Inline $${inlineTex}$ remains math.\n\n$$ ${displayTex} $$`,
      resolveAsset,
    )

    expect(rendered.html).toContain(`<annotation encoding="application/x-tex">${inlineTex}</annotation>`)
    expect(rendered.html).toContain(`<annotation encoding="application/x-tex">${displayTex}</annotation>`)
    expect(rendered.html).toContain('paper-task-reader__math--block')
    expect(rendered.html).not.toContain('<em>')
    expect(rendered.html).not.toContain('公式暂无法排版，保留原式：')
  })

  it('keeps fenced code inert inside blockquotes and resumes prose math afterward', () => {
    const samples = [
      '> ```\n> $$literal\n> ```\n> prose$$\n>\n> Outside $x_i$.',
      '> ~~~\n> $$literal\n> ~~~~\n> prose$$\n>\n> Outside $x_i$.',
    ]

    for (const sample of samples) {
      const rendered = renderPaperTaskReaderMarkdown(sample, resolveAsset)

      expect(rendered.html).toContain('<blockquote>')
      expect(rendered.html).toMatch(/<pre><code>\$\$literal\s*<\/code><\/pre>/u)
      expect(rendered.html).toContain('<p>prose$$</p>')
      expect(rendered.html).toContain('<annotation encoding="application/x-tex">x_i</annotation>')
      expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">literal</annotation>')
      expect(rendered.html).not.toContain('PTMATHPLACEHOLDER')
    }
  })

  it('keeps fenced code inert in list items and leaves following list prose intact', () => {
    const samples = [
      '- ```\n  $$literal\n  ```\n- prose$$\n- Outside $x_i$.',
      '- ~~~\n  $$literal\n  ~~~~\n- prose$$\n- Outside $x_i$.',
    ]

    for (const sample of samples) {
      const rendered = renderPaperTaskReaderMarkdown(sample, resolveAsset)

      expect(rendered.html).toMatch(/<li><pre><code>\$\$literal\s*<\/code><\/pre><\/li>/u)
      expect(rendered.html).toContain('<li>prose$$</li>')
      expect(rendered.html).toContain('<annotation encoding="application/x-tex">x_i</annotation>')
      expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">literal</annotation>')
      expect(rendered.html).not.toContain('PTMATHPLACEHOLDER')
    }
  })

  it('does not typeset dollar-like text inside a GFM bare URL but preserves explicit link-label math', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      'https://example.test/$x$\n\n[visible $y_i$](https://example.test/$z$)',
      resolveAsset,
    )

    expect(rendered.html).toContain('<a href="https://example.test/$x$" rel="noopener noreferrer">https://example.test/$x$</a>')
    expect(rendered.html).toContain('<a href="https://example.test/$z$" rel="noopener noreferrer">visible ')
    expect(rendered.html).toContain('<annotation encoding="application/x-tex">y_i</annotation>')
    expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">x</annotation>')
    expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">z</annotation>')
  })

  it('restores original math in heading text and code fences while leaving escaped delimiters inert', () => {
    const rendered = renderPaperTaskReaderMarkdown(
      '# Score $x_i$\n\n## Result $y_j$\n\n```tex\n$z_k$\n```\n\nLiteral \\$w_m$',
      resolveAsset,
    )

    expect(rendered.title).toBe('Score $x_i$')
    expect(rendered.headings).toEqual([{ id: 'result-y-j', text: 'Result $y_j$', depth: 2 }])
    expect(rendered.html).toContain('<annotation encoding="application/x-tex">y_j</annotation>')
    expect(rendered.html).toMatch(/<pre><code>\$z_k\$\s*<\/code><\/pre>/u)
    expect(rendered.html).toContain('Literal $w_m$')
    expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">z_k</annotation>')
    expect(rendered.html).not.toContain('<annotation encoding="application/x-tex">w_m</annotation>')
    expect(rendered.html).not.toContain('PTMATHPLACEHOLDER')
  })

  it('falls back to escaped source when strict KaTeX parsing rejects an expression', () => {
    const html = renderPaperTaskReaderMarkdown('$\\unknownCommand{<img src=x onerror=alert(1)>}$', resolveAsset).html

    expect(html).toContain('公式暂无法排版，保留原式：')
    expect(html).toContain('\\unknownCommand{&lt;img src=x onerror=alert(1)&gt;}')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
  })

  it('bounds formula source before KaTeX expansion and preserves an honest fallback', () => {
    const formula = `\\text{${'x'.repeat(1_200)}}`
    const html = renderPaperTaskReaderMarkdown(`$${formula}$`, resolveAsset).html

    expect(html).toContain('公式暂无法排版，保留原式：')
    expect(html).toContain('x'.repeat(1_200))
    expect(html).not.toContain('<span class="katex">')
  })

  it('does not trust TeX commands that could create links or HTML attributes', () => {
    const html = renderPaperTaskReaderMarkdown(
      '$\\href{javascript:alert(1)}{点击} \\htmlClass{danger}{文字}$',
      resolveAsset,
    ).html

    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('class="danger"')
    expect(html).not.toContain('<script')
  })

  it('escapes every non-math text segment before it reaches v-html', () => {
    const html = renderPaperTaskReaderMarkdown('\\<img src=x onerror=alert(1)>', resolveAsset).html

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
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
