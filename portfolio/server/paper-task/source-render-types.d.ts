import type { SKRSContext2D } from '@napi-rs/canvas'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api.js'

// PDF.js supports NodeCanvasFactory at runtime, but its distributed render type only declares DOM canvases.
declare module 'pdfjs-dist/types/src/display/api.js' {
  interface PDFPageProxy {
    render(params: {
      readonly canvas: null
      readonly canvasContext: SKRSContext2D
      readonly viewport: ReturnType<PDFPageProxy['getViewport']>
    }): RenderTask
  }
}
