/**
 * Safe renderers for the retained natural Chinese translation master (issue #46)
 * and the C focused-reading view (issue #48).
 *
 * Plain CommonMark plus GFM tables are parsed with raw HTML disabled, then
 * rendered through an allowlist. Original assets are embedded only when the
 * application resolves an `asset:<id>` reference from the current task; remote
 * images, arbitrary local paths, and executable markup never reach the DOM.
 * The reader renderer additionally extracts the single article title, returns
 * the real heading index used by the table of contents, wraps wide tables, and
 * shows math delimiters as inert visible text instead of executing anything.
 *
 * Pure synchronous functions: unit-testable in the node vitest environment.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import type { Element, Nodes, Root, Text } from 'hast'
import { PAPER_TASK_ASSET_URL_SCHEME } from './paper-task-translation-contract'

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li', 'hr', 'br',
  'strong', 'em', 'code', 'pre', 'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
])

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const URL_BASE = 'https://paper-task.local/'
const TASK_ASSET_ID = /^asset-[a-z0-9]+$/u
const MATH_TOKEN = /\$\$([\s\S]+?)\$\$|\$(?![\s$])([^$\n]*?[^\s$])\$/gu

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
  readonly headingIds: Set<string>
  readonly headings: PaperTaskReaderHeading[]
  readonly state: RenderState
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

/** Text content of an element for heading slugs; raw/comment nodes are ignored. */
function elementTextContent(node: Element): string {
  let out = ''
  for (const child of node.children ?? []) {
    if (child.type === 'text') {
      out += child.value
    } else if (child.type === 'element') {
      out += elementTextContent(child)
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

/** Inert visible math: every non-math segment is escaped, never interpreted as markup. */
function renderTextWithMath(value: string, options: RenderOptions): string {
  if (!options.math) return escapeHtml(value)
  let out = ''
  let lastIndex = 0
  for (const match of value.matchAll(MATH_TOKEN)) {
    const index = match.index ?? 0
    out += escapeHtml(value.slice(lastIndex, index))
    if (match[1] !== undefined) {
      out += `<span class="paper-task-reader__math paper-task-reader__math--block" role="math">${escapeHtml(match[1].trim())}</span>`
    } else {
      out += `<span class="paper-task-reader__math" role="math">${escapeHtml((match[2] ?? '').trim())}</span>`
    }
    lastIndex = index + match[0].length
  }
  out += escapeHtml(value.slice(lastIndex))
  return out
}

function renderChildren(children: readonly Nodes[] | undefined, options: RenderOptions, block = false): string {
  let out = ''
  for (const child of children ?? []) {
    if (child.type === 'text') {
      if (block && /^\s*$/u.test((child as Text).value)) continue
      out += renderTextWithMath((child as Text).value, options)
    } else {
      out += renderNode(child, options)
    }
  }
  return out
}

function renderNode(node: Nodes, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return renderTextWithMath(node.value, options)
    case 'raw':
      return escapeHtml((node as { value: string }).value)
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
      const safe = safeLinkHref(href)
      if (safe !== null) {
        return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${renderChildren(node.children, options)}</a>`
      }
    }
    return renderChildren(node.children, options)
  }

  if (tag === 'img') {
    const src = node.properties?.src
    const alt = typeof node.properties?.alt === 'string' ? node.properties.alt : ''
    if (typeof src !== 'string' || !src.startsWith(PAPER_TASK_ASSET_URL_SCHEME)) {
      return alt === '' ? '' : escapeHtml(alt)
    }
    const assetId = src.slice(PAPER_TASK_ASSET_URL_SCHEME.length)
    if (!TASK_ASSET_ID.test(assetId)) return alt === '' ? '' : escapeHtml(alt)
    const resolved = options.resolveAsset(assetId)
    if (resolved === null) return alt === '' ? '' : escapeHtml(alt)
    return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
  }

  if (tag.startsWith('h') && tag.length === 2) {
    const depth = Number(tag[1])
    const text = elementTextContent(node)
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
  const root = parsed.runSync(parsed.parse(markdown)) as Root
  return renderChildren(root.children, {
    resolveAsset,
    reader: false,
    math: false,
    headingIds: new Set<string>(),
    headings: [],
    state: { title: null },
  }, true)
}

/**
 * Renders one task Markdown master as a focused reader document: the first h1
 * becomes the page title, all real h2/h3 headings become TOC entries with
 * deterministic ids, tables get a horizontal-scroll wrapper, and math stays
 * inert text. The allowlist and URL/asset gates are shared with the preview
 * renderer.
 */
export function renderPaperTaskReaderMarkdown(
  markdown: string,
  resolveAsset: PaperTaskAssetResolver,
): PaperTaskReaderMarkdown {
  const parsed = processor()
  const root = parsed.runSync(parsed.parse(markdown)) as Root
  const state: RenderState = { title: null }
  const headings: PaperTaskReaderHeading[] = []
  const html = renderChildren(root.children, {
    resolveAsset,
    reader: true,
    math: true,
    headingIds: new Set<string>(),
    headings,
    state,
  }, true)
  return { title: state.title, html, headings }
}
