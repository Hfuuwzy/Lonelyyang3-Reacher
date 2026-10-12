import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type {} from './source-render-types'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas'
import type { PaperTaskSourceAsset, PaperTaskSourceRecord } from '../../app/utils/paper-task-source-contract'

type NativeCanvasModule = { readonly createCanvas: (width: number, height: number) => Canvas }
type FactoryCanvas = { readonly canvas: Canvas; readonly context: SKRSContext2D }
type CanvasFactory = {
  create(width: number, height: number): FactoryCanvas
  destroy(canvas: FactoryCanvas): void
}

const MAX_SOURCE_ASSET_BYTES = 32 * 1024 * 1024

function nativeCanvasModule(value: unknown): value is NativeCanvasModule {
  return typeof value === 'object' && value !== null && 'createCanvas' in value
    && typeof value.createCanvas === 'function'
}

function canvasFactory(value: object): value is CanvasFactory {
  return 'create' in value && typeof value.create === 'function'
    && 'destroy' in value && typeof value.destroy === 'function'
}

const requireFromProject = createRequire(resolve(process.cwd(), 'package.json'))
const requireFromPdfJs = createRequire(requireFromProject.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
const nativeCanvas: unknown = requireFromPdfJs('@napi-rs/canvas')

function cropBounds(
  bbox: readonly [number, number, number, number],
  kind: PaperTaskSourceRecord['kind'],
  pageWidth: number,
  pageHeight: number,
): readonly [number, number, number, number] {
  const [x, y, width, height] = bbox
  const margin = kind === 'table' || kind === 'algorithm' ? 42 : 12
  const verticalMargin = kind === 'table' ? 0 : margin
  const left = Math.max(0, Math.floor(x - margin))
  const top = Math.max(0, Math.floor(y - verticalMargin))
  const right = Math.min(pageWidth, Math.ceil(x + width + margin))
  const bottom = Math.min(pageHeight, Math.ceil(y + height + verticalMargin))
  return [left, top, Math.max(1, right - left), Math.max(1, bottom - top)]
}

function renderScale(width: number, height: number): number {
  return Math.min(2, Math.sqrt(2_000_000 / (width * height)))
}

function unavailable(record: PaperTaskSourceRecord): PaperTaskSourceAsset {
  return {
    recordId: record.id, page: record.page, bbox: record.bbox, availability: 'unavailable',
    understanding: 'unverified', mediaType: 'image/png', bytes: null,
  }
}

async function renderPage(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
  records: readonly PaperTaskSourceRecord[],
  byteBudget: number,
): Promise<readonly PaperTaskSourceAsset[]> {
  const baseViewport = page.getViewport({ scale: 1 })
  const outputScale = renderScale(baseViewport.width, baseViewport.height)
  const viewport = page.getViewport({ scale: outputScale })
  const width = Math.ceil(viewport.width)
  const height = Math.ceil(viewport.height)
  if (!Number.isFinite(outputScale) || outputScale < 1 || width < 1 || height < 1) return records.map(unavailable)
  const factory = document.canvasFactory
  if (!canvasFactory(factory) || !nativeCanvasModule(nativeCanvas)) return records.map(unavailable)
  const pageCanvas = factory.create(width, height)
  try {
    await page.render({ canvas: null, canvasContext: pageCanvas.context, viewport }).promise
    const assets: PaperTaskSourceAsset[] = []
    let usedBytes = 0
    for (const record of records) {
      if (record.kind === 'table' && record.state === 'ambiguous') {
        assets.push(unavailable(record))
        continue
      }
      const scaledBbox = record.bbox.map((value) => value * outputScale)
      const [sourceX, sourceY, sourceWidth, sourceHeight] = record.bbox
      if (sourceX < 0 || sourceY < 0 || sourceX + sourceWidth > baseViewport.width
        || sourceY + sourceHeight > baseViewport.height) {
        assets.push(unavailable(record))
        continue
      }
      const [left, top, cropWidth, cropHeight] = cropBounds(
        [scaledBbox[0] ?? 0, scaledBbox[1] ?? 0, scaledBbox[2] ?? 0, scaledBbox[3] ?? 0],
        record.kind,
        width,
        height,
      )
      if (cropWidth * cropHeight > 1_500_000) {
        assets.push(unavailable(record))
        continue
      }
      const crop = nativeCanvas.createCanvas(cropWidth, cropHeight)
      const context = crop.getContext('2d')
      context.drawImage(pageCanvas.canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
      const bytes = crop.toBuffer('image/png')
      if (usedBytes + bytes.byteLength > byteBudget) {
        assets.push(unavailable(record))
        continue
      }
      usedBytes += bytes.byteLength
      assets.push({
        recordId: record.id, page: record.page,
        bbox: [left / outputScale, top / outputScale, cropWidth / outputScale, cropHeight / outputScale],
        availability: 'available' as const, understanding: 'unverified' as const, mediaType: 'image/png' as const,
        bytes,
      })
    }
    return assets
  } finally {
    factory.destroy(pageCanvas)
  }
}

export async function renderSourceAssets(
  document: PDFDocumentProxy,
  records: readonly PaperTaskSourceRecord[],
  signal?: AbortSignal,
): Promise<readonly PaperTaskSourceAsset[]> {
  const visualRecords = records.filter((record) =>
    record.kind === 'table' || record.kind === 'formula' || record.kind === 'algorithm',
  )
  const assets: PaperTaskSourceAsset[] = []
  let totalBytes = 0
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal?.aborted) return visualRecords.map(unavailable)
    const pageRecords = visualRecords.filter((record) => record.page === pageNumber)
    if (pageRecords.length === 0) continue
    const page = await document.getPage(pageNumber)
    const pageAssets = await renderPage(document, page, pageRecords, MAX_SOURCE_ASSET_BYTES - totalBytes)
    assets.push(...pageAssets)
    totalBytes += pageAssets.reduce((sum, asset) => sum + (asset.bytes?.byteLength ?? 0), 0)
    page.cleanup()
  }
  return assets
}
