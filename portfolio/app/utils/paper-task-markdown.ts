/**
 * Safe renderer for the retained natural Chinese translation master (issue #46).
 *
 * Plain CommonMark is parsed with raw HTML disabled, then rendered through an
 * allowlist. Original assets are embedded only when the application resolves
 * an `asset:<id>` reference from the current task; remote images, arbitrary
 * local paths, and executable markup never reach the DOM. Unlike the older
 * paper-review renderer, the master keeps its own `h1` title because the task
 * page does not supply a separate article masthead.
 *
 * Pure synchronous function: unit-testable in the node vitest environment.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import type { Element, Nodes, Root, Text } from 'hast'
import { PAPER_TASK_ASSET_URL_SCHEME } from './paper-task-translation-contract'

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li', 'hr', 'br',
  'strong', 'em', 'code', 'pre', 'a', 'img',
])

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const URL_BASE = 'https://paper-task.local/'

/** Resolves a validated task asset id to a same-origin URL, or null. */
export type PaperTaskAssetResolver = (assetId: string) => string | null

interface RenderOptions {
  readonly resolveAsset: PaperTaskAssetResolver
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

function renderChildren(children: readonly Nodes[] | undefined, options: RenderOptions, block = false): string {
  let out = ''
  for (const child of children ?? []) {
    if (child.type === 'text') {
      if (block && /^\s*$/u.test((child as Text).value)) continue
      out += escapeHtml(child.value)
    } else {
      out += renderNode(child, options)
    }
  }
  return out
}

function renderNode(node: Nodes, options: RenderOptions): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)
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
    const resolved = options.resolveAsset(assetId)
    if (resolved === null) return alt === '' ? '' : escapeHtml(alt)
    return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
  }

  const blockContainer = tag === 'blockquote' || tag === 'li' || tag === 'ul' || tag === 'ol'
  return `<${tag}>${renderChildren(node.children, options, blockContainer)}</${tag}>`
}

export function renderPaperTaskTranslationMarkdown(
  markdown: string,
  resolveAsset: PaperTaskAssetResolver,
): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: false })
  const root = processor.runSync(processor.parse(markdown)) as Root
  return renderChildren(root.children, { resolveAsset }, true)
}
