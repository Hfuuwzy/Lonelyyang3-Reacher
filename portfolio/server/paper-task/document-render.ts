import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import PDFDocument from 'pdfkit'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'

export interface PaperTaskRenderAsset {
  readonly id: string
  readonly bytes?: Uint8Array
}

export interface PaperTaskBoundaryCheck {
  readonly method: 'ordered-normalized-text-extraction'
  readonly passed: true
  readonly sourceMasterSha256: string
  readonly sourceBlocks: number
  readonly matchedBlocks: number
}

export interface RenderedPaperTaskDocument {
  readonly bytes: Buffer
  readonly pageCount: number
  readonly boundaryCheck: PaperTaskBoundaryCheck
  readonly blockers: readonly string[]
}

interface MarkdownNode {
  readonly type: string
  readonly value?: string
  readonly url?: string
  readonly alt?: string
  readonly depth?: number
  readonly ordered?: boolean | null
  readonly start?: number | null
  readonly children?: readonly MarkdownNode[]
}

type InlineNode =
  | { readonly kind: 'text'; readonly text: string; readonly bold: boolean; readonly italic: boolean; readonly code: boolean }
  | { readonly kind: 'image'; readonly id: string; readonly alt: string }

type ContentBlock =
  | { readonly kind: 'paragraph'; readonly runs: readonly InlineNode[]; readonly heading?: number; readonly code?: boolean; readonly quote?: boolean }
  | { readonly kind: 'table'; readonly rows: readonly (readonly (readonly InlineNode[])[])[] }
  | { readonly kind: 'rule' }

const require = createRequire(import.meta.url)
const CJK_FONT_PATH = require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2') as string
const MAX_EXPORT_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 20_000

/**
 * Render a Markdown master into a text-based PDF, then extract text from the
 * final container and compare each source block in order.
 * Font and layout success alone are deliberately not considered a boundary check.
 */
export async function renderPaperTaskPdf(
  markdown: string,
  assets: readonly PaperTaskRenderAsset[],
): Promise<RenderedPaperTaskDocument> {
  const blocks = markdownBlocks(markdown)
  const sourceTexts = markdownSourceTexts(markdown)
  if (sourceTexts.length === 0) throw new Error('Markdown master contains no exportable text')
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
  const blockers = new Set<string>()
  const bytes = await renderPdf(blocks, assetMap, blockers)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) throw new Error('rendered document exceeds the artifact size limit')

  const actualText = await extractPdfText(bytes)
  if (!containsBlocksInOrder(sourceTexts, actualText)) {
    throw new Error('rendered document does not preserve the approved Markdown content')
  }
  const pageCount = await countPdfPages(bytes)
  const boundaryCheck: PaperTaskBoundaryCheck = {
    method: 'ordered-normalized-text-extraction',
    passed: true,
    sourceMasterSha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
    sourceBlocks: sourceTexts.length,
    matchedBlocks: sourceTexts.length,
  }
  return {
    bytes,
    pageCount,
    boundaryCheck,
    blockers: [...blockers],
  }
}

function markdownBlocks(markdown: string): readonly ContentBlock[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode
  const blocks: ContentBlock[] = []
  const collect = (node: MarkdownNode, inherited: { bold: boolean; italic: boolean; code: boolean } = { bold: false, italic: false, code: false }): void => {
    switch (node.type) {
      case 'heading':
      case 'paragraph': {
        const runs = inlineRuns(node.children ?? [], inherited)
        if (runs.length > 0) blocks.push({ kind: 'paragraph', runs, ...(node.type === 'heading' ? { heading: Math.min(node.depth ?? 1, 6) } : {}) })
        return
      }
      case 'blockquote':
        for (const child of node.children ?? []) collect(child, { ...inherited, italic: true })
        return
      case 'list':
        for (const [index, item] of (node.children ?? []).entries()) {
          let firstParagraph = true
          for (const child of item.children ?? []) {
            if (child.type === 'paragraph') {
              const marker = firstParagraph
                ? node.ordered === true ? `${(node.start ?? 1) + index}. ` : '• '
                : '  '
              blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: marker, bold: false, italic: false, code: false }, ...inlineRuns(child.children ?? [], inherited)] })
              firstParagraph = false
            } else {
              collect(child, inherited)
            }
          }
        }
        return
      case 'code':
        if ((node.value ?? '').length > 0) blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: node.value ?? '', ...inherited, code: true }], code: true })
        return
      case 'table': {
        const rows = (node.children ?? []).map((row) => (row.children ?? []).map((cell) => inlineRuns(cell.children ?? [], inherited)))
        if (rows.length > 0) blocks.push({ kind: 'table', rows })
        return
      }
      case 'thematicBreak':
        blocks.push({ kind: 'rule' })
        return
      case 'html':
        if ((node.value ?? '').trim() !== '') blocks.push({ kind: 'paragraph', runs: [{ kind: 'text', text: node.value ?? '', ...inherited }] })
        return
      default:
        for (const child of node.children ?? []) collect(child, inherited)
    }
  }
  for (const child of tree.children ?? []) collect(child)
  return blocks
}

function inlineRuns(nodes: readonly MarkdownNode[], style: { bold: boolean; italic: boolean; code: boolean }): InlineNode[] {
  const runs: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'image') {
      const match = /^asset:([a-z0-9-]+)$/u.exec(node.url ?? '')
      if (match?.[1] === undefined) throw new Error('document image does not reference a controlled task asset')
      runs.push({ kind: 'image', id: match[1], alt: node.alt ?? '' })
      continue
    }
    if (node.type === 'text' || node.type === 'inlineCode') {
      const text = node.value ?? ''
      if (text !== '') runs.push({ kind: 'text', text, ...style, code: style.code || node.type === 'inlineCode' })
      continue
    }
    if (node.type === 'break') {
      runs.push({ kind: 'text', text: '\n', ...style })
      continue
    }
    const childStyle = {
      bold: style.bold || node.type === 'strong',
      italic: style.italic || node.type === 'emphasis' || node.type === 'delete',
      code: style.code,
    }
    runs.push(...inlineRuns(node.children ?? [], childStyle))
  }
  return runs
}

function markdownSourceTexts(markdown: string): string[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MarkdownNode
  const texts: string[] = []
  const collect = (node: MarkdownNode): void => {
    if (node.type === 'list') {
      for (const [index, item] of (node.children ?? []).entries()) {
        const itemChildren = item.children ?? []
        if (itemChildren.some((child) => child.type === 'paragraph')) {
          texts.push(node.ordered === true ? `${(node.start ?? 1) + index}. ` : '• ')
        }
        for (const child of itemChildren) collect(child)
      }
      return
    }
    if (node.type === 'image') {
      const alt = node.alt ?? ''
      if (normalizeText(alt) !== '') texts.push(alt)
      return
    }
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code' || node.type === 'html') {
      const value = node.value ?? ''
      if (normalizeText(value) !== '') texts.push(value)
      return
    }
    for (const child of node.children ?? []) collect(child)
  }
  for (const child of tree.children ?? []) collect(child)
  return texts
}

async function renderPdf(
  blocks: readonly ContentBlock[],
  assets: ReadonlyMap<string, PaperTaskRenderAsset>,
  blockers: Set<string>,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const document = new PDFDocument({ autoFirstPage: true, bufferPages: true, size: 'A4', margins: { top: 58, right: 60, bottom: 62, left: 60 } })
    document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)))
    document.once('error', reject)
    document.once('end', () => resolve(Buffer.concat(chunks)))
    try {
      document.registerFont('PaperTaskCjk', CJK_FONT_PATH)
      document.font('PaperTaskCjk').fillColor('#1f252b')
      for (const block of blocks) {
        if (block.kind === 'rule') {
          ensurePageRoom(document, 18)
          const y = document.y + 3
          document.moveTo(document.page.margins.left, y).lineTo(document.page.width - document.page.margins.right, y).strokeColor('#aaa59d').lineWidth(0.5).stroke()
          document.moveDown(1)
          continue
        }
        if (block.kind === 'table') {
          for (const row of block.rows) {
            writePdfText(document, row.map(inlineText).join('    |    '), { size: 10, gap: 5 })
            for (const cell of row) {
              for (const run of cell) if (run.kind === 'image') writePdfImage(document, run, assets, blockers)
            }
          }
          document.moveDown(0.8)
          continue
        }
        const textRuns = block.runs.filter((run): run is Extract<InlineNode, { kind: 'text' }> => run.kind === 'text')
        const size = block.heading === undefined ? block.code === true ? 9 : 11 : Math.max(13, 24 - block.heading * 2)
        const textOptions = {
          size,
          gap: block.heading === undefined ? 5 : 7,
          indent: block.quote === true || textRuns.some((run) => run.italic) ? 12 : 0,
        }
        let text = ''
        const flushText = (): void => {
          if (text.trim() !== '') writePdfText(document, text, textOptions)
          text = ''
        }
        for (const run of block.runs) {
          if (run.kind === 'text') text += run.text
          else {
            flushText()
            writePdfImage(document, run, assets, blockers)
          }
        }
        flushText()
      }
      const range = document.bufferedPageRange()
      const pageCount = range.count
      for (let index = range.start; index < range.start + pageCount; index += 1) {
        document.switchToPage(index)
        document.font('PaperTaskCjk').fontSize(8).fillColor('#77736d')
          .text(`${index + 1} / ${pageCount}`, 60, document.page.height - 35, { align: 'center', width: document.page.width - 120, lineBreak: false })
      }
      document.end()
    } catch (error) {
      document.destroy()
      reject(error)
    }
  })
}

function inlineText(runs: readonly InlineNode[]): string {
  return runs.map((run) => run.kind === 'text' ? run.text : run.alt).join('')
}

function writePdfText(
  document: InstanceType<typeof PDFDocument>,
  text: string,
  options: { readonly size: number; readonly gap: number; readonly indent?: number },
): void {
  const fontSize = options.size
  document.font('PaperTaskCjk').fontSize(fontSize).fillColor('#1f252b')
  const inset = options.indent ?? 0
  const availableWidth = document.page.width - document.page.margins.left - document.page.margins.right - inset
  const estimated = document.heightOfString(text, { width: availableWidth, fontSize, lineGap: 2 }) + options.gap
  ensurePageRoom(document, Math.min(estimated, document.page.height - document.page.margins.top - document.page.margins.bottom))
  document.text(text, { width: availableWidth, indent: inset, fontSize, lineGap: 2, paragraphGap: options.gap, continued: false })
}

function writePdfImage(
  document: InstanceType<typeof PDFDocument>,
  image: Extract<InlineNode, { kind: 'image' }>,
  assets: ReadonlyMap<string, PaperTaskRenderAsset>,
  blockers: Set<string>,
): void {
  const asset = assets.get(image.id)
  if (asset?.bytes === undefined) {
    blockers.add(`asset-unavailable:${image.id}`)
    writePdfText(document, image.alt === '' ? `[图像不可用 ${image.id}]` : image.alt, { size: 10, gap: 6, indent: 12 })
    return
  }
  const dimensions = pngDimensions(asset.bytes)
  if (dimensions === undefined) {
    blockers.add(`asset-invalid:${image.id}`)
    writePdfText(document, image.alt === '' ? `[图像不可读 ${image.id}]` : image.alt, { size: 10, gap: 6, indent: 12 })
    return
  }
  const width = document.page.width - document.page.margins.left - document.page.margins.right
  const scale = Math.min(width / dimensions.width, 340 / dimensions.height)
  const imageWidth = dimensions.width * scale
  const imageHeight = dimensions.height * scale
  const captionHeight = image.alt.trim() === '' ? 0
    : document.heightOfString(image.alt, { width: Math.max(1, width - 12), fontSize: 9, lineGap: 2 }) + 10
  const contentHeight = document.page.height - document.page.margins.top - document.page.margins.bottom
  ensurePageRoom(document, Math.min(imageHeight + captionHeight + 8, contentHeight))
  const y = document.y + 4
  document.image(asset.bytes, document.page.margins.left + (width - imageWidth) / 2, y, { width: imageWidth, height: imageHeight })
  document.y = y + imageHeight + 4
  if (image.alt.trim() !== '') writePdfText(document, image.alt, { size: 9, gap: 10, indent: 12 })
}

function ensurePageRoom(document: InstanceType<typeof PDFDocument>, height: number): void {
  if (document.y + height > document.page.height - document.page.margins.bottom) document.addPage()
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  const pdf = await loading.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const text = await page.getTextContent()
      pages.push(text.items.flatMap((item) => 'str' in item && typeof item.str === 'string' ? [item.str] : []).join(' '))
    }
    return pages.join(' ')
  } finally {
    await loading.destroy()
  }
}

async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  const pdf = await loading.promise
  try {
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 5000) throw new Error('rendered PDF page count is outside the supported range')
    return pdf.numPages
  } finally {
    await loading.destroy()
  }
}

function containsBlocksInOrder(blocks: readonly string[], actual: string): boolean {
  const content = normalizeText(actual)
  let cursor = 0
  for (const block of blocks) {
    const expected = normalizeText(block)
    if (expected === '') continue
    const found = content.indexOf(expected, cursor)
    if (found < 0) return false
    cursor = found + expected.length
  }
  return true
}

function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/[\s\u00a0]+/gu, '')
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  if (bytes.byteLength < 24 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined
  const width = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(16)
  const height = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(20)
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return undefined
  return { width, height }
}
