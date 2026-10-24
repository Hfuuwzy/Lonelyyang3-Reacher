import { describe, expect, it } from 'vitest'
import { renderPaperTaskTranslationMarkdown } from '../../app/utils/paper-task-markdown'

const ASSET_URL = '/api/prototype/paper-task/123e4567-e89b-12d3-a456-426614174000/assets/asset-abc'
const resolveAsset = (assetId: string): string | null => assetId === 'asset-abc' ? ASSET_URL : null

describe('translation master rendering', () => {
  it('keeps the master title and a continuous reading order', () => {
    const html = renderPaperTaskTranslationMarkdown('# 论文标题\n\n第一段。\n\n## 附录 A\n\n第二段。', resolveAsset)
    expect(html).toBe('<h1>论文标题</h1><p>第一段。</p><h2>附录 A</h2><p>第二段。</p>')
  })

  it('renders only safe scholarly superscript and subscript tags inline', () => {
    const html = renderPaperTaskTranslationMarkdown('作者<sup>1,2</sup> 与 H<sub>2</sub>O。', resolveAsset)

    expect(html).toBe('<p>作者<sup>1,2</sup> 与 H<sub>2</sub>O。</p>')
  })

  it('renders a controlled original asset with its translated caption', () => {
    const html = renderPaperTaskTranslationMarkdown('![表1 各组结果](asset:asset-abc)', resolveAsset)
    expect(html).toBe(`<p><img src="${ASSET_URL}" alt="表1 各组结果" loading="lazy" decoding="async"></p>`)
  })

  it('drops remote, foreign, and unresolved images while keeping the caption text', () => {
    expect(renderPaperTaskTranslationMarkdown('![远程](https://example.com/a.png)', resolveAsset)).toBe('<p>远程</p>')
    expect(renderPaperTaskTranslationMarkdown('![外来](asset:asset-other)', resolveAsset)).toBe('<p>外来</p>')
    expect(renderPaperTaskTranslationMarkdown('![路径](../../original.pdf)', resolveAsset)).toBe('<p>路径</p>')
  })

  it('keeps raw HTML and MDC syntax inert', () => {
    const html = renderPaperTaskTranslationMarkdown('<script>alert(1)</script>\n\n::dangerous[prop]', resolveAsset)
    expect(html).not.toContain('<script')
    expect(html).toContain('::dangerous[prop]')
  })

  it('drops unsafe links but keeps their label', () => {
    const html = renderPaperTaskTranslationMarkdown('[点我](javascript:alert(1))', resolveAsset)
    expect(html).toBe('<p>点我</p>')
  })

  it('preserves safe external and relative links', () => {
    expect(renderPaperTaskTranslationMarkdown('[原文](https://example.com/paper)', resolveAsset))
      .toBe('<p><a href="https://example.com/paper" rel="noopener noreferrer">原文</a></p>')
    expect(renderPaperTaskTranslationMarkdown('[附录](#附录)', resolveAsset))
      .toBe('<p><a href="#%E9%99%84%E5%BD%95" rel="noopener noreferrer">附录</a></p>')
  })
})
