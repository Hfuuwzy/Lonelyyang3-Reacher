/**
 * Safe renderer for the app-projected paper-review Markdown (untrusted model
 * prose is embedded by the projection with escaping; this module is the second
 * line of defense).
 *
 * Pipeline: plain CommonMark parsing (`remark-parse`), then `remark-rehype`
 * with raw HTML disabled, then an allowlist walk over the resulting hast tree.
 * MDC component syntax is deliberately NOT enabled, so `::name`/`:a[prop]`
 * constructs stay inert plain text and can never render as components or
 * elements; raw HTML is ignored by remark-rehype instead of executed.
 *
 * Link hrefs are validated after browser-style resolution: control characters
 * and spaces are rejected outright, the WHATWG URL parser classifies every
 * remaining href, and only http:/https:/mailto: plus same-origin relative/hash
 * links survive. The app-owned `pdf://N` marker is rewritten to the live PDF
 * object URL fragment, or unwrapped without one. Every other attribute is
 * stripped. Headings get deterministic ids and a TOC is returned alongside, so
 * the reader rail and the headings can never diverge.
 *
 * Pure synchronous function: unit-testable in the node vitest environment.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import type { Element, Nodes, Root, Text } from 'hast'

export interface PaperReviewRenderedHeading {
  readonly id: string
  readonly text: string
  readonly depth: number
}

export interface PaperReviewRenderedMarkdown {
  readonly html: string
  readonly headings: readonly PaperReviewRenderedHeading[]
}

/** Tags the projection may emit; anything else (MDC components, media) is dropped. */
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li', 'hr', 'br',
  'strong', 'em', 'code', 'pre', 'a',
])

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const PDF_PAGE_MARKER = /^pdf:\/\/(\d+)$/
const URL_BASE = 'https://reader.local/'

interface RenderOptions {
  readonly pdfUrl: string | null
  readonly headingIds: Map<string, number>
  readonly headings: PaperReviewRenderedHeading[]
  /** Whitespace-only text siblings inside block containers are skipped. */
  readonly block: boolean
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
function uniqueHeadingId(value: string, ids: Map<string, number>): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const root = base === '' ? 'section' : base
  const count = ids.get(root) ?? 0
  ids.set(root, count + 1)
  return count === 0 ? root : `${root}-${count}`
}

/** True when the value contains ASCII controls, a space, or DEL — URL-normalization bait. */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * WHATWG-based href gate: control characters and spaces are rejected before
 * parsing (the URL parser would otherwise strip tab/LF/CR and normalize a
 * `java\tscript:` href into an executable `javascript:` scheme), and only
 * explicit safe schemes or same-origin relative/hash links survive.
 */
function safeLinkHref(href: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '' || hasControlOrSpace(trimmed)) {
    return null
  }
  if (trimmed.startsWith('//')) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed, URL_BASE)
  } catch {
    return null
  }
  if (SAFE_URL_SCHEMES.has(parsed.protocol)) {
    return trimmed
  }
  // Relative and hash links resolve inside the reader origin.
  if (parsed.protocol === 'https:' && parsed.origin === new URL(URL_BASE).origin) {
    return trimmed
  }
  return null
}

/** App-owned `pdf://N` marker -> live PDF object URL fragment; unwraps otherwise. */
function resolveHref(href: string, pdfUrl: string | null): string | null {
  const trimmed = href.trim()
  if (trimmed === '' || hasControlOrSpace(trimmed)) {
    return null
  }
  const match = PDF_PAGE_MARKER.exec(trimmed)
  if (match !== null) {
    if (pdfUrl === null) {
      return null
    }
    return `${pdfUrl}#page=${match[1]}`
  }
  return safeLinkHref(trimmed)
}

function renderChildren(children: readonly Nodes[] | undefined, options: RenderOptions): string {
  let out = ''
  for (const child of children ?? []) {
    if (child.type === 'text') {
      if (options.block && /^\s*$/.test((child as Text).value)) {
        continue
      }
      out += escapeHtml((child as Text).value)
    } else {
      out += renderNode(child, options)
    }
  }
  return out
}

function renderNode(node: Nodes, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return escapeHtml((node as Text).value)
    case 'raw':
      // Never produced with raw HTML disabled; kept as literal text if present.
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
  if (!ALLOWED_TAGS.has(tag)) {
    return ''
  }
  if (tag === 'hr') {
    return '<hr>'
  }
  if (tag === 'br') {
    return '<br>'
  }

  if (tag === 'a') {
    const href = node.properties?.href
    if (typeof href === 'string') {
      const resolved = resolveHref(href, options.pdfUrl)
      if (resolved !== null) {
        const external = /^blob:/.test(resolved) ? ' rel="noopener" target="_blank"' : ''
        return `<a href="${escapeHtml(resolved)}"${external}>${renderChildren(node.children, options)}</a>`
      }
    }
    // Unsafe or unresolvable link: keep the label as plain text, drop the href.
    return renderChildren(node.children, options)
  }

  if (tag.startsWith('h') && tag.length === 2) {
    const depth = Number(tag[1])
    const text = elementTextContent(node)
    if (text.trim() === '' || depth < 1 || depth > 6) {
      return ''
    }
    // h1 is carried by the reader masthead; it stays in the downloaded .md only.
    if (depth === 1) {
      return ''
    }
    const id = uniqueHeadingId(text, options.headingIds)
    options.headings.push({ id, text: text.trim(), depth })
    const inner = renderChildren(node.children, { ...options, block: false })
    return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>`
  }

  const blockContainer = tag === 'blockquote' || tag === 'li' || tag === 'ul' || tag === 'ol'
  const inner = renderChildren(node.children, { ...options, block: blockContainer })
  return `<${tag}>${inner}</${tag}>`
}

/**
 * Parses an untrusted Markdown fragment with the plain CommonMark parser and
 * renders only the allowlisted, sanitized subset to HTML. Returns the HTML plus
 * the ordered heading index (id/text/depth) for the reader rail.
 */
export function renderPaperReviewMarkdown(markdown: string, pdfUrl: string | null): PaperReviewRenderedMarkdown {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
  const root = processor.runSync(processor.parse(markdown)) as Root
  const headings: PaperReviewRenderedHeading[] = []
  const html = renderChildren(root.children, {
    pdfUrl,
    headingIds: new Map<string, number>(),
    headings,
    block: true,
  })
  return { html, headings }
}