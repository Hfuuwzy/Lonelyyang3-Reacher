import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileStyle, parse } from '@vue/compiler-sfc'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { renderPaperTaskReaderMarkdown } from '../../app/utils/paper-task-markdown'

const ASSET_URL = '/api/prototype/paper-task/123e4567-e89b-12d3-a456-426614174000/assets/asset-abc'
const resolveAsset = (assetId: string): string | null => assetId === 'asset-abc' ? ASSET_URL : null
const STYLE_ID = 'data-v-paper-task-reader-content-layout'
const STYLE_PATH = fileURLToPath(new URL('../../app/assets/css/paper-task-reader.css', import.meta.url))
const COMPONENT_PATH = fileURLToPath(new URL('../../app/components/agents/PaperTaskReader.vue', import.meta.url))

function styledReader(markdownHtml: string, withComponentStyles = false) {
  const compiledStyles = [compileStyle({
    source: readFileSync(STYLE_PATH, 'utf8'),
    filename: STYLE_PATH,
    id: STYLE_ID,
    scoped: true,
  })]
  if (withComponentStyles) {
    const component = parse(readFileSync(COMPONENT_PATH, 'utf8'), { filename: COMPONENT_PATH })
    if (component.errors.length > 0) throw new Error(`paper reader component parsing failed (${component.errors.length})`)
    const componentStyle = component.descriptor.styles.find((style) => style.scoped && !style.src)
    if (componentStyle === undefined) throw new Error('scoped paper reader component stylesheet was not found')
    compiledStyles.push(compileStyle({
      source: componentStyle.content,
      filename: COMPONENT_PATH,
      id: STYLE_ID,
      scoped: true,
    }))
  }
  if (compiledStyles.some((compiled) => compiled.errors.length > 0)) {
    throw new Error('paper reader stylesheets failed to compile')
  }

  const window = new Window()
  const { document } = window
  for (const compiled of compiledStyles) {
    const style = document.createElement('style')
    style.textContent = compiled.code
    document.head.append(style)
  }

  const root = document.createElement('div')
  root.className = 'paper-task-reader'
  root.setAttribute(STYLE_ID, '')
  const body = document.createElement('div')
  body.className = 'paper-task-reader__body'
  body.setAttribute(STYLE_ID, '')
  body.innerHTML = markdownHtml
  root.append(body)
  document.body.append(root)
  return { window, root, componentCss: compiledStyles[1]?.code ?? null }
}

describe('paper-task reader content layout', () => {
  it('gives GFM headers and cells the same start alignment without changing cell order', () => {
    const html = renderPaperTaskReaderMarkdown(
      '| Dataset | Method | F1 |\n| :--- | ---: | ---: |\n| Set A | Model 1 | 0.943 |',
      resolveAsset,
    ).html
    const { window, root } = styledReader(html)

    try {
      const headers = [...root.querySelectorAll('th')]
      const cells = [...root.querySelectorAll('td')]
      expect(headers.map((cell) => cell.textContent)).toEqual(['Dataset', 'Method', 'F1'])
      expect(cells.map((cell) => cell.textContent)).toEqual(['Set A', 'Model 1', '0.943'])
      expect(headers.map((cell) => window.getComputedStyle(cell).textAlign)).toEqual(['start', 'start', 'start'])
      expect(cells.map((cell) => window.getComputedStyle(cell).textAlign)).toEqual(['start', 'start', 'start'])
      const table = root.querySelector('table')
      expect(table).not.toBeNull()
      if (table === null) throw new Error('controlled reader table was not rendered')
      expect(window.getComputedStyle(table).fontSize).toBe('18px')
    } finally {
      window.close()
    }
  })

  it('keeps preformatted trees readable and unwrapped', () => {
    const html = renderPaperTaskReaderMarkdown(
      '```text\nroot\n└── branch\n```\n\n| Dataset | F1 |\n| --- | ---: |\n| Set A | 0.943 |',
      resolveAsset,
    ).html
    const { window, root } = styledReader(html)

    try {
      const pre = root.querySelector('pre')
      const tableWrapper = root.querySelector('.paper-task-reader__table')
      expect(pre).not.toBeNull()
      expect(tableWrapper).not.toBeNull()
      if (pre === null || tableWrapper === null) {
        throw new Error('controlled tree or table fixture did not render')
      }
      const code = pre.querySelector('code')
      expect(code).not.toBeNull()
      if (code === null) throw new Error('controlled tree code was not rendered')

      const preStyle = window.getComputedStyle(pre)
      const codeStyle = window.getComputedStyle(code)
      expect(preStyle.fontSize).toBe('17px')
      expect(codeStyle.fontSize).toBe('17px')
      expect(preStyle.lineHeight).toBe('1.75')
      expect(preStyle.paddingTop).toBe('18px')
      expect(preStyle.whiteSpace).toBe('pre')
      expect(preStyle.overflowX).toBe('auto')
      expect(preStyle.overflowY).toBe('auto')
      expect(preStyle.overscrollBehaviorX).toBe('contain')
      expect(preStyle.overscrollBehaviorY).toBe('auto')
    } finally {
      window.close()
    }
  })

  it('chains vertical wheel scrolling over rendered tables through the component stylesheet', () => {
    const html = renderPaperTaskReaderMarkdown(
      '| Dataset | F1 |\n| --- | ---: |\n| Set A | 0.943 |',
      resolveAsset,
    ).html
    const { window, root, componentCss } = styledReader(html, true)

    try {
      const tableWrapper = root.querySelector('.paper-task-reader__table')
      expect(tableWrapper).not.toBeNull()
      if (tableWrapper === null) throw new Error('controlled Markdown table was not rendered')

      const style = window.getComputedStyle(tableWrapper)
      expect(style.overflowX).toBe('auto')
      expect(style.overflowY).toBe('auto')
      expect(style.overscrollBehaviorX).toBe('contain')
      expect(style.overscrollBehaviorY).toBe('auto')

      const componentTableRule = componentCss?.match(/\.paper-task-reader__table\s*\{([^}]*)\}/u)?.[1] ?? ''
      expect(componentTableRule).toMatch(/overscroll-behavior-x:\s*contain;/u)
      expect(componentTableRule).toMatch(/overscroll-behavior-y:\s*auto;/u)
    } finally {
      window.close()
    }
  })

  it('keeps task images intrinsic-ratio, centered, uncropped, and constrained only by the reader column', () => {
    const html = renderPaperTaskReaderMarkdown('![Figure](asset:asset-abc)', resolveAsset).html
    const { window, root } = styledReader(html)

    try {
      const image = root.querySelector('img')
      expect(image).not.toBeNull()
      if (image === null) throw new Error('controlled reader image was not rendered')
      image.setAttribute('width', '646')
      image.setAttribute('height', '665')
      const style = window.getComputedStyle(image)

      expect(style.inlineSize).toBe('auto')
      expect(style.maxInlineSize).toBe('100%')
      expect(style.blockSize).toBe('auto')
      expect(style.objectFit).toBe('contain')
      expect(style.marginLeft).toBe('auto')
      expect(style.marginRight).toBe('auto')

      const sourceLink = root.querySelector('.paper-task-reader__image-source')
      expect(sourceLink).not.toBeNull()
      if (sourceLink === null) throw new Error('same-task PDF fallback was not rendered')
      expect(sourceLink.textContent).toContain('提取裁片')
      const sourceLinkStyle = window.getComputedStyle(sourceLink)
      expect(sourceLinkStyle.display).toBe('block')
      expect(sourceLinkStyle.textAlign).toBe('center')
      expect(sourceLinkStyle.marginLeft).toBe('auto')
      expect(sourceLinkStyle.marginRight).toBe('auto')
    } finally {
      window.close()
    }
  })
})
