/**
 * Safe renderers for the retained natural Chinese translation master (issue #46)
 * and the C focused-reading view (issue #48).
 *
 * Plain CommonMark plus GFM tables are parsed with raw HTML disabled, then
 * rendered through an allowlist. Original assets are embedded only when the
 * application resolves an `asset:<id>` reference from the current task; remote
 * images, arbitrary local paths, and executable markup never reach the DOM.
 * The reader renderer additionally extracts the single article title, returns
 * the real heading index used by the table of contents, wraps wide tables,
 * protects TeX before CommonMark parsing, and typesets it through KaTeX with an
 * escaped source fallback.
 *
 * Pure synchronous functions: unit-testable in the node vitest environment.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import type { Element, Nodes, Root, Text } from 'hast'
import { renderToString } from 'katex'
import { paperTaskIdSchema } from './paper-task-contract'
import { paperTaskPdfPath } from './paper-task-reader-contract'
import { PAPER_TASK_ASSET_URL_SCHEME } from './paper-task-translation-contract'

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li', 'hr', 'br',
  'strong', 'em', 'sup', 'sub', 'code', 'pre', 'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
])

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const URL_BASE = 'https://paper-task.local/'
const TASK_ASSET_ID = /^asset-[a-z0-9]+$/u
const MAX_MATH_SOURCE_LENGTH = 1_000
const MAX_MATH_EXPRESSIONS = 200
const MAX_MATH_TOTAL_SOURCE_LENGTH = 40_000
const MATH_FALLBACK_LABEL = '公式暂无法排版，保留原式：'
const MATH_PLACEHOLDER_BASE = 'PTMATHPLACEHOLDER'
const MATH_PLACEHOLDER_END = 'END'

/** Resolves a validated task asset id to a same-origin URL, or null. */
export type PaperTaskAssetResolver = (assetId: string) => string | null

export interface PaperTaskReaderHeading {
  readonly id: string
  readonly text: string
  readonly depth: number
}

export interface PaperTaskReaderMarkdown {
  readonly title: string | null
  readonly html: string
  readonly headings: readonly PaperTaskReaderHeading[]
}

interface RenderState {
  title: string | null
}

interface RenderOptions {
  readonly resolveAsset: PaperTaskAssetResolver
  readonly reader: boolean
  readonly math: boolean
  readonly mathPlaceholderPrefix: string | null
  readonly mathTokens: ReadonlyMap<string, MathToken>
  readonly headingIds: Set<string>
  readonly headings: PaperTaskReaderHeading[]
  readonly state: RenderState
  readonly mathBudget: MathRenderBudget
}

interface MathToken {
  readonly source: string
  readonly literal: string
  readonly displayMode: boolean
}

interface PreparedMathMarkdown {
  readonly markdown: string
  readonly placeholderPrefix: string | null
  readonly tokens: ReadonlyMap<string, MathToken>
}

interface MathRenderBudget {
  expressions: number
  sourceLength: number
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

function safeLinkHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '' || hasControlOrSpace(trimmed) || trimmed.startsWith('//')) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed, URL_BASE)
  } catch {
    return null
  }
  if (SAFE_URL_SCHEMES.has(parsed.protocol)) return trimmed
  if (parsed.protocol === 'https:' && parsed.origin === new URL(URL_BASE).origin) return trimmed
  return null
}

/**
 * Derive the same-task PDF fallback only from the reader's controlled asset
 * route. The reader contract currently omits page provenance, so do not invent
 * a `#page=` target.
 */
function originalPdfPathForAsset(resolvedAssetUrl: string, assetId: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(resolvedAssetUrl, URL_BASE)
  } catch {
    return null
  }
  if (parsed.origin !== new URL(URL_BASE).origin || parsed.search !== '' || parsed.hash !== '') return null

  const match = /^\/api\/prototype\/paper-task\/([^/]+)\/assets\/(asset-[a-z0-9]+)$/u.exec(parsed.pathname)
  if (match?.[2] !== assetId) return null
  const taskId = paperTaskIdSchema.safeParse(match[1])
  if (!taskId.success) return null
  return paperTaskPdfPath(taskId.data, 'original', 'open')
}

/** Text content of an element for heading slugs; raw/comment nodes are ignored. */
function elementTextContent(node: Element, options: RenderOptions): string {
  let out = ''
  for (const child of node.children ?? []) {
    if (child.type === 'text') {
      out += restoreMathPlaceholders(child.value, options)
    } else if (child.type === 'element') {
      out += elementTextContent(child, options)
    }
  }
  return out
}

/** github-slugger-style unique slug: keeps letters/numbers (incl. CJK), dashes for spaces. */
function uniqueHeadingId(value: string, ids: Set<string>): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'
  let candidate = base
  let suffix = 1
  while (ids.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  ids.add(candidate)
  return candidate
}

function renderMath(source: string, displayMode: boolean, options: RenderOptions): string {
  const tex = source.trim()
  options.mathBudget.expressions += 1
  options.mathBudget.sourceLength += tex.length

  const displayClass = displayMode ? ' paper-task-reader__math--block' : ''
  const fallback = `<span class="paper-task-reader__math-fallback${displayClass}" role="math">${MATH_FALLBACK_LABEL}<code>${escapeHtml(tex)}</code></span>`
  if (tex.length === 0
    || tex.length > MAX_MATH_SOURCE_LENGTH
    || options.mathBudget.expressions > MAX_MATH_EXPRESSIONS
    || options.mathBudget.sourceLength > MAX_MATH_TOTAL_SOURCE_LENGTH) {
    return fallback
  }

  try {
    const html = renderToString(tex, {
      displayMode,
      output: 'htmlAndMathml',
      trust: false,
      strict: 'error',
      throwOnError: true,
      maxExpand: 200,
      maxSize: 10,
      macros: {},
    })
    return `<span class="paper-task-reader__math${displayClass}" role="math">${html}</span>`
  } catch {
    return fallback
  }
}

/** Keep raw Markdown HTML as ordinary text so it cannot run or disappear inside a formula. */
function convertRawMarkdownHtmlToText(
  node: { readonly children?: unknown[] },
  options: Pick<RenderOptions, 'mathPlaceholderPrefix' | 'mathTokens'>,
): void {
  for (const child of node.children ?? []) {
    if (child === null || typeof child !== 'object') continue
    const childNode = child as { type?: string; value?: string; children?: unknown[] }
    if (childNode.type === 'html') {
      if (typeof childNode.value === 'string') {
        childNode.value = restoreMathPlaceholders(childNode.value, options)
      }
      childNode.type = 'text'
      continue
    }
    convertRawMarkdownHtmlToText(childNode, options)
  }
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}

function runLengthAt(value: string, index: number, character: string): number {
  let length = 0
  while (value[index + length] === character) length += 1
  return length
}

interface MathProtectionRange {
  readonly start: number
  readonly end: number
  readonly kind: 'code' | 'definition' | 'bare-url'
}

interface MarkdownSourceNode {
  readonly type: string
  readonly value?: string
  readonly position?: {
    readonly start?: { readonly offset?: number }
    readonly end?: { readonly offset?: number }
  }
  readonly children?: readonly MarkdownSourceNode[]
}

/** Use CommonMark/GFM source offsets for code and container-aware syntax. */
function mathProtectionRanges(markdown: string): readonly MathProtectionRange[] {
  const tree = processor().parse(markdown) as unknown as MarkdownSourceNode
  const ranges: MathProtectionRange[] = []

  function visit(node: MarkdownSourceNode): void {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      if (node.type === 'code' || node.type === 'inlineCode') {
        ranges.push({ start, end, kind: 'code' })
      } else if (node.type === 'definition') {
        ranges.push({ start, end, kind: 'definition' })
      } else if (node.type === 'link' && node.children?.length === 1) {
        const child = node.children[0]
        const source = markdown.slice(start, end)
        if (child?.type === 'text'
          && child.value === source
          && /^(?:https?:\/\/|www\.)/iu.test(source)) {
          // GFM bare-autolinks use the URL as their visible text. Explicit
          // Markdown link labels remain eligible for math rendering.
          ranges.push({ start, end, kind: 'bare-url' })
        }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(tree)
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  return ranges
}

function findMathEnd(
  value: string,
  contentStart: number,
  displayMode: boolean,
  protectedRanges: readonly MathProtectionRange[],
): number {
  let cursor = contentStart
  let rangeIndex = 0
  while ((protectedRanges[rangeIndex]?.end ?? Number.POSITIVE_INFINITY) <= cursor) rangeIndex += 1

  while (cursor < value.length) {
    const protectedRange = protectedRanges[rangeIndex]
    if (protectedRange !== undefined && cursor >= protectedRange.start && cursor < protectedRange.end) {
      if (protectedRange.kind !== 'bare-url') return -1
      cursor = protectedRange.end
      rangeIndex += 1
      continue
    }
    if (!displayMode && (value[cursor] === '\n' || value[cursor] === '\r')) return -1
    if (value[cursor] !== '$' || isEscapedAt(value, cursor)) {
      cursor += 1
      continue
    }
    const length = runLengthAt(value, cursor, '$')
    if (displayMode && length === 2) return cursor
    if (!displayMode && length === 1 && cursor > contentStart && !/\s/u.test(value[cursor - 1] ?? '')) {
      return cursor
    }
    cursor += length
  }
  return -1
}

function linkDestinationEnd(value: string, closingBracket: number): number {
  let cursor = closingBracket + 1
  while (cursor < value.length && /[   \n]/u.test(value[cursor] ?? '')) cursor += 1
  if (value[cursor] !== '(' || isEscapedAt(value, cursor)) return -1

  cursor += 1
  let depth = 1
  let angleDestination = false
  for (; cursor < value.length; cursor += 1) {
    const character = value[cursor]
    if (character === '\n' || character === '\r') return -1
    if (character === '\\') {
      cursor += 1
      continue
    }
    if (character === '<' && depth === 1) angleDestination = true
    else if (character === '>' && angleDestination) angleDestination = false
    else if (!angleDestination && character === '(') depth += 1
    else if (!angleDestination && character === ')') {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
  }
  return -1
}

function rawHtmlEnd(value: string, start: number): number {
  if (value.startsWith('<!--', start)) {
    const end = value.indexOf('-->', start + 4)
    return end < 0 ? value.length : end + 3
  }
  if (!/^<(?:\/?[A-Za-z]|[!?])/u.test(value.slice(start, start + 3))) return -1

  let quote: '"' | "'" | null = null
  for (let cursor = start + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor]
    if (quote !== null) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return cursor + 1
    }
  }
  return value.length
}

/**
 * Protect TeX before CommonMark can interpret TeX underscores or emphasis as
 * Markdown. Parser-identified code/container ranges, link destinations, and
 * GFM bare URLs stay inert; placeholders are restored before URL validation.
 */
function protectMarkdownMath(markdown: string): PreparedMathMarkdown {
  let salt = 0
  let placeholderPrefix = `${MATH_PLACEHOLDER_BASE}${salt}X`
  while (markdown.includes(placeholderPrefix)) {
    salt += 1
    placeholderPrefix = `${MATH_PLACEHOLDER_BASE}${salt.toString(36)}X`
  }

  const tokens = new Map<string, MathToken>()
  const protectedRanges = mathProtectionRanges(markdown)
  let protectedRangeIndex = 0
  let cursor = 0
  let copiedUntil = 0
  let output = ''

  while (cursor < markdown.length) {
    while ((protectedRanges[protectedRangeIndex]?.end ?? Number.POSITIVE_INFINITY) <= cursor) {
      protectedRangeIndex += 1
    }
    const protectedRange = protectedRanges[protectedRangeIndex]
    if (protectedRange !== undefined && cursor >= protectedRange.start && cursor < protectedRange.end) {
      cursor = protectedRange.end
      protectedRangeIndex += 1
      continue
    }

    if (markdown[cursor] === ']' && !isEscapedAt(markdown, cursor)) {
      const destinationEnd = linkDestinationEnd(markdown, cursor)
      if (destinationEnd >= 0) {
        cursor = destinationEnd
        continue
      }
    }

    if (markdown[cursor] === '<') {
      const htmlEnd = rawHtmlEnd(markdown, cursor)
      if (htmlEnd >= 0) {
        cursor = htmlEnd
        continue
      }
    }

    if (markdown[cursor] !== '$' || isEscapedAt(markdown, cursor)) {
      cursor += 1
      continue
    }

    const openingLength = runLengthAt(markdown, cursor, '$')
    const displayMode = openingLength === 2
    if ((!displayMode && openingLength !== 1)
      || (!displayMode && (/\s/u.test(markdown[cursor + 1] ?? '') || markdown[cursor + 1] === '$'))) {
      cursor += openingLength
      continue
    }

    const contentStart = cursor + openingLength
    const closing = findMathEnd(markdown, contentStart, displayMode, protectedRanges)
    if (closing < 0) {
      cursor += openingLength
      continue
    }
    const closingLength = displayMode ? 2 : 1
    const end = closing + closingLength
    const literal = markdown.slice(cursor, end)
    const source = markdown.slice(contentStart, closing)
    if (source.trim() === '') {
      cursor = end
      continue
    }

    const placeholder = `${placeholderPrefix}${tokens.size.toString(36)}${MATH_PLACEHOLDER_END}`
    output += markdown.slice(copiedUntil, cursor)
    output += placeholder
    tokens.set(placeholder, { source, literal, displayMode })
    cursor = end
    copiedUntil = end
  }

  if (tokens.size === 0) return { markdown, placeholderPrefix: null, tokens }
  output += markdown.slice(copiedUntil)
  return { markdown: output, placeholderPrefix, tokens }
}

function restoreMathPlaceholders(value: string, options: Pick<RenderOptions, 'mathPlaceholderPrefix' | 'mathTokens'>): string {
  const prefix = options.mathPlaceholderPrefix
  if (prefix === null || options.mathTokens.size === 0) return value

  let output = ''
  let copiedUntil = 0
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf(prefix, cursor)
    if (start < 0) break
    const endMarker = value.indexOf(MATH_PLACEHOLDER_END, start + prefix.length)
    if (endMarker < 0) break
    const end = endMarker + MATH_PLACEHOLDER_END.length
    const placeholder = value.slice(start, end)
    const token = options.mathTokens.get(placeholder)
    if (token === undefined) {
      cursor = end
      continue
    }
    output += value.slice(copiedUntil, start) + token.literal
    copiedUntil = end
    cursor = end
  }
  return copiedUntil === 0 ? value : output + value.slice(copiedUntil)
}

/** Typesets protected math placeholders; ordinary text always stays escaped. */
function renderTextWithMath(value: string, options: RenderOptions): string {
  const prefix = options.mathPlaceholderPrefix
  if (prefix === null || options.mathTokens.size === 0) return escapeHtml(value)

  let output = ''
  let copiedUntil = 0
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf(prefix, cursor)
    if (start < 0) break
    const endMarker = value.indexOf(MATH_PLACEHOLDER_END, start + prefix.length)
    if (endMarker < 0) break
    const end = endMarker + MATH_PLACEHOLDER_END.length
    const placeholder = value.slice(start, end)
    const token = options.mathTokens.get(placeholder)
    if (token === undefined) {
      cursor = end
      continue
    }
    output += escapeHtml(value.slice(copiedUntil, start))
    output += options.math
      ? renderMath(token.source, token.displayMode, options)
      : escapeHtml(token.literal)
    copiedUntil = end
    cursor = end
  }
  return copiedUntil === 0 ? escapeHtml(value) : output + escapeHtml(value.slice(copiedUntil))
}

interface MarkdownNodeLike {
  readonly type: string
  readonly value?: string
  children?: MarkdownNodeLike[]
  readonly data?: {
    readonly hName?: string
    readonly hProperties?: Record<string, unknown>
  }
}

interface ScholarlyMarkupFrame {
  readonly tag: 'sup' | 'sub'
  readonly openingNode: MarkdownNodeLike
  readonly children: MarkdownNodeLike[]
}

function scholarlyMarkupToken(node: MarkdownNodeLike): { readonly tag: 'sup' | 'sub'; readonly closing: boolean } | null {
  if (node.type !== 'html' || node.value === undefined) return null
  const match = /^<(\/)?(sup|sub)>$/u.exec(node.value)
  if (match === null) return null
  return { tag: match[2] as 'sup' | 'sub', closing: match[1] === '/' }
}

function scholarlyElement(tag: 'sup' | 'sub', children: MarkdownNodeLike[]): MarkdownNodeLike {
  // The renderer only receives the tag name and an empty property object. No
  // source HTML attributes or other raw markup are carried into the HAST.
  return { type: 'emphasis', data: { hName: tag, hProperties: {} }, children }
}

/**
 * Converts only balanced, attribute-free inline scholarly tags into
 * application-owned Markdown nodes. Other raw HTML remains inert text.
 */
function convertSafeScholarlyInlineMarkup(node: MarkdownNodeLike): void {
  const children = node.children
  if (children === undefined) return

  for (const child of children) convertSafeScholarlyInlineMarkup(child)

  const output: MarkdownNodeLike[] = []
  const frames: ScholarlyMarkupFrame[] = []
  const currentChildren = (): MarkdownNodeLike[] => frames.at(-1)?.children ?? output

  for (const child of children) {
    const token = scholarlyMarkupToken(child)
    if (token === null) {
      currentChildren().push(child)
      continue
    }

    if (!token.closing) {
      frames.push({ tag: token.tag, openingNode: child, children: [] })
      continue
    }

    const frame = frames.at(-1)
    if (frame?.tag !== token.tag) {
      currentChildren().push(child)
      continue
    }

    frames.pop()
    currentChildren().push(scholarlyElement(frame.tag, frame.children))
  }

  // Unclosed or mismatched pairs must not disappear or become elements.
  while (frames.length > 0) {
    const frame = frames.pop()
    if (frame === undefined) continue
    currentChildren().push(frame.openingNode, ...frame.children)
  }

  node.children = output
}

function renderChildren(children: readonly Nodes[] | undefined, options: RenderOptions, block = false): string {
  let out = ''
  const nodes = children ?? []
  for (let index = 0; index < nodes.length;) {
    const child = nodes[index]
    if (child === undefined) {
      index += 1
      continue
    }
    if (child.type === 'text') {
      let value = (child as Text).value
      let nextIndex = index + 1
      while (true) {
        const next = nodes[nextIndex]
        if (next?.type !== 'text') break
        value += next.value
        nextIndex += 1
      }
      if (!block || !/^\s*$/u.test(value)) out += renderTextWithMath(value, options)
      index = nextIndex
    } else {
      out += renderNode(child, options)
      index += 1
    }
  }
  return out
}

function renderNode(node: Nodes, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return renderTextWithMath(node.value, options)
    case 'raw':
      return escapeHtml(restoreMathPlaceholders((node as { value: string }).value, options))
    case 'comment':
      return ''
    case 'element':
      return renderElement(node, options)
    default:
      return ''
  }
}

function renderElement(node: Element, options: RenderOptions): string {
  const tag = node.tagName
  if (!ALLOWED_TAGS.has(tag)) return ''
  if (tag === 'hr') return '<hr>'
  if (tag === 'br') return '<br>'

  if (tag === 'a') {
    const href = node.properties?.href
    if (typeof href === 'string') {
      const safe = safeLinkHref(restoreMathPlaceholders(href, options))
      if (safe !== null) {
        return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${renderChildren(node.children, options)}</a>`
      }
    }
    return renderChildren(node.children, options)
  }

  if (tag === 'img') {
    const src = node.properties?.src
    const alt = typeof node.properties?.alt === 'string'
      ? restoreMathPlaceholders(node.properties.alt, options)
      : ''
    const restoredSrc = typeof src === 'string' ? restoreMathPlaceholders(src, options) : null
    if (restoredSrc === null || !restoredSrc.startsWith(PAPER_TASK_ASSET_URL_SCHEME)) {
      return alt === '' ? '' : escapeHtml(alt)
    }
    const assetId = restoredSrc.slice(PAPER_TASK_ASSET_URL_SCHEME.length)
    if (!TASK_ASSET_ID.test(assetId)) return alt === '' ? '' : escapeHtml(alt)
    const resolved = options.resolveAsset(assetId)
    if (resolved === null) return alt === '' ? '' : escapeHtml(alt)
    const image = `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
    if (!options.reader) return image

    const originalPdfPath = originalPdfPathForAsset(resolved, assetId)
    if (originalPdfPath === null) return image
    return `${image}<a class="paper-task-reader__image-source" href="${escapeHtml(originalPdfPath)}" target="_blank" rel="noopener noreferrer">打开原论文 PDF 核对完整页面（当前配图为提取裁片）</a>`
  }

  if (tag.startsWith('h') && tag.length === 2) {
    const depth = Number(tag[1])
    const text = elementTextContent(node, options)
    if (text.trim() === '' || depth < 1 || depth > 6) return ''
    if (!options.reader) {
      return `<h${depth}>${renderChildren(node.children, options)}</h${depth}>`
    }
    let effectiveDepth = depth
    if (depth === 1) {
      if (options.state.title === null) {
        options.state.title = text.trim()
        return ''
      }
      // The page owns one article title; later h1s remain sections.
      effectiveDepth = 2
    }
    const id = uniqueHeadingId(text, options.headingIds)
    if (effectiveDepth === 2 || effectiveDepth === 3) {
      options.headings.push({ id, text: text.trim(), depth: effectiveDepth })
    }
    return `<h${effectiveDepth} id="${escapeHtml(id)}">${renderChildren(node.children, options)}</h${effectiveDepth}>`
  }

  if (tag === 'table') {
    const inner = renderChildren(node.children, options, true)
    return options.reader
      ? `<div class="paper-task-reader__table"><table>${inner}</table></div>`
      : `<table>${inner}</table>`
  }

  if (tag === 'code' || tag === 'pre') {
    return `<${tag}>${renderChildren(node.children, { ...options, math: false })}</${tag}>`
  }

  const blockContainer = tag === 'blockquote' || tag === 'li' || tag === 'ul' || tag === 'ol'
  return `<${tag}>${renderChildren(node.children, options, blockContainer)}</${tag}>`
}

function processor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
}

export function renderPaperTaskTranslationMarkdown(
  markdown: string,
  resolveAsset: PaperTaskAssetResolver,
): string {
  const parsed = processor()
  const tree = parsed.parse(markdown)
  convertSafeScholarlyInlineMarkup(tree as unknown as MarkdownNodeLike)
  convertRawMarkdownHtmlToText(tree, { mathPlaceholderPrefix: null, mathTokens: new Map() })
  const root = parsed.runSync(tree) as Root
  return renderChildren(root.children, {
    resolveAsset,
    reader: false,
    math: false,
    mathPlaceholderPrefix: null,
    mathTokens: new Map(),
    headingIds: new Set<string>(),
    headings: [],
    state: { title: null },
    mathBudget: { expressions: 0, sourceLength: 0 },
  }, true)
}

/**
 * Renders one task Markdown master as a focused reader document: the first h1
 * becomes the page title, all real h2/h3 headings become TOC entries with
 * deterministic ids, tables get a horizontal-scroll wrapper, and math is
 * typeset through KaTeX with escaped source fallback. The allowlist and URL/asset gates are shared with the preview
 * renderer.
 */
export function renderPaperTaskReaderMarkdown(
  markdown: string,
  resolveAsset: PaperTaskAssetResolver,
): PaperTaskReaderMarkdown {
  const preparedMath = protectMarkdownMath(markdown)
  const parsed = processor()
  const tree = parsed.parse(preparedMath.markdown)
  convertSafeScholarlyInlineMarkup(tree as unknown as MarkdownNodeLike)
  convertRawMarkdownHtmlToText(tree, {
    mathPlaceholderPrefix: preparedMath.placeholderPrefix,
    mathTokens: preparedMath.tokens,
  })
  const root = parsed.runSync(tree) as Root
  const state: RenderState = { title: null }
  const headings: PaperTaskReaderHeading[] = []
  const html = renderChildren(root.children, {
    resolveAsset,
    reader: true,
    math: true,
    mathPlaceholderPrefix: preparedMath.placeholderPrefix,
    mathTokens: preparedMath.tokens,
    headingIds: new Set<string>(),
    headings,
    state,
    mathBudget: { expressions: 0, sourceLength: 0 },
  }, true)
  return { title: state.title, html, headings }
}
