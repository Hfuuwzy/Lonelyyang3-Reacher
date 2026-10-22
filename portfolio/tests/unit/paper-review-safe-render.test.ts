import { describe, expect, it } from 'vitest'
import { renderPaperReviewMarkdown } from '../../app/utils/paper-review-safe-render'

function render(markdown: string, pdfUrl: string | null = null) {
  const out = renderPaperReviewMarkdown(markdown, pdfUrl)
  return { html: out.html, headings: out.headings }
}

describe('renderPaperReviewMarkdown — unsafe link handling', () => {
  it('unwraps javascript:, data:, vbscript:, and file: links keeping only the label text', () => {
    const md = '[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](file:///etc/passwd)'
    const { html } = render(md)
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:')
    expect(html).not.toContain('href="vbscript:')
    expect(html).not.toContain('href="file:')
    expect(html).toContain('<p>a b c d</p>')
  })

  it('rejects mixed-case scheme variants after WHATWG normalization', () => {
    const { html } = render('[a](JaVaScRiPt:alert(1))')
    expect(html).not.toContain('href=')
    expect(html).toContain('<p>a</p>')
  })

  it('never renders an anchor when the href carries tab/LF/CR (URL-normalization bait)', () => {
    // Browsers strip tab/LF/CR before navigating, which would turn
    // `java\tscript:` into an executable `javascript:` scheme. Plain CommonMark
    // keeps these as literal text; the renderer must neither emit an anchor.
    const { html } = render('[a](java\tscript:alert(1)) [b](java\nscript:alert(2)) [c](java\rscript:alert(3))')
    expect(html).not.toContain('<a')
    expect(html).toContain('[a](java')
    expect(html).toContain('[b](java')
    expect(html).toContain('[c](java')
  })

  it('drops protocol-relative links and empty urls', () => {
    const { html } = render('[x](//evil.example) [y]()')
    expect(html).toContain('<p>x y</p>')
    expect(html).not.toContain('href=')
  })

  it('keeps http, https, mailto, relative, and hash links with their href', () => {
    const md = '[h](https://e.com) [a](http://e.com) [m](mailto:x@y) [r](./page) [f](#anchor)'
    const { html } = render(md)
    expect(html).toContain('href="https://e.com"')
    expect(html).toContain('href="http://e.com"')
    expect(html).toContain('href="mailto:x@y"')
    expect(html).toContain('href="./page"')
    expect(html).toContain('href="#anchor"')
  })

  it('drops link titles and any non-href attributes', () => {
    const { html } = render('[x](https://e.com "title")')
    expect(html).toContain('<a href="https://e.com">x</a>')
    expect(html).not.toContain('title=')
  })
})

describe('renderPaperReviewMarkdown — MDC syntax and raw HTML are inert', () => {
  it('renders MDC component syntax as literal text, never as a component', () => {
    const { html } = render('::alert\nThis is a component\n::')
    expect(html).not.toContain('<alert')
    expect(html).not.toContain('This is a component</')
    expect(html).toContain('::alert')
  })

  it('renders MDC attribute bindings (lowercase a and v-bind aliases) as literal text, never an element', () => {
    const { html } = render(':a[click]{href="javascript:alert(1)"} and ::a{v-bind:href="x"}')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('click="')
    // The constructs stay inert as escaped literal text, ready for display.
    expect(html).toContain(':a[click]')
    expect(html).toContain('::a{v-bind:href')
  })

  it('drops raw HTML entirely (allowDangerousHtml disabled)', () => {
    const { html } = render('<script>alert(1)</script> <a href="javascript:alert(1)">x</a>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('<a href')
  })

  it('drops images regardless of protocol', () => {
    const { html } = render('![alt](https://e.com/x.png) ![d](data:image/png;base64,x)')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data:image')
  })
})

describe('renderPaperReviewMarkdown — pdf:// markers', () => {
  it('rewrites app-owned pdf://N markers to the live PDF object URL fragment', () => {
    const { html } = render('[原文 PDF 第 2 页](pdf://2)', 'blob:pdf-1')
    expect(html).toContain('<a href="blob:pdf-1#page=2" rel="noopener" target="_blank">原文 PDF 第 2 页</a>')
  })

  it('unwraps pdf:// markers when no PDF URL is held', () => {
    const { html } = render('[原文 PDF 第 2 页](pdf://2)', null)
    expect(html).toContain('原文 PDF 第 2 页')
    expect(html).not.toContain('href=')
  })

  it('never rewrites non-numeric or control-carrying pdf: markers', () => {
    const { html } = render('[x](pdf://javascript:alert(1)) [y](pdf://\t2)')
    expect(html).not.toContain('href=')
  })
})

describe('renderPaperReviewMarkdown — headings, ids, and order', () => {
  it('drops h1 from the page HTML but keeps it in the downloaded markdown', () => {
    const { html } = render('# Title\n\ntext')
    expect(html).not.toContain('<h1')
    expect(html).toContain('text')
  })

  it('assigns deterministic ids (CJK-safe) to headings and returns them in order', () => {
    const { html, headings } = render('## 1 Introduction\n\na\n\n## 方法 · 主要论断\n\nb\n\n## 1 Introduction\n\nc')
    expect(headings.map((h) => h.id)).toEqual(['1-introduction', '方法-主要论断', '1-introduction-1'])
    expect(headings.map((h) => h.depth)).toEqual([2, 2, 2])
    expect(html).toContain('<h2 id="1-introduction">1 Introduction</h2>')
    expect(html).toContain('<h2 id="方法-主要论断">方法 · 主要论断</h2>')
    expect(html).toContain('<h2 id="1-introduction-1">1 Introduction</h2>')
  })

  it('keeps h2/h3/h4 in the page HTML', () => {
    const { html } = render('## A\n\n### B\n\n#### C')
    expect(html).toContain('<h2 id="a">A</h2>')
    expect(html).toContain('<h3 id="b">B</h3>')
    expect(html).toContain('<h4 id="c">C</h4>')
  })

  it('keeps an escaped line-leading # as a visible paragraph, never a dropped h1', () => {
    const { html } = render('\\# 重要内容\n继续同一段')
    expect(html).toContain('# 重要内容')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('<h2')
    expect(html).toContain('继续同一段')
  })

  it('renders preserved code fences as inert pre/code with the exact literal original', () => {
    const original = 'Method | Accuracy\nCalibrated | 92.4%\nE = mc^2\nraw <b>html</b> stays text'
    const { html } = render('```\n' + original + '\n```')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('Calibrated | 92.4%')
    expect(html).toContain('&lt;b&gt;html&lt;/b&gt;')
    expect(html).not.toContain('<b>html</b>')
    expect(html).not.toContain('<h1')
  })

  it('renders blockquote, lists, emphasis, and inline code from the allowlist', () => {
    const { html } = render('> quote **strong** *em* and `code`\n\n- one\n- two')
    expect(html).toContain('<blockquote><p>quote <strong>strong</strong> <em>em</em> and <code>code</code></p></blockquote>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
  })
})