export const PAPER_TASK_SOURCE_KINDS = [
  'heading',
  'body',
  'appendix',
  'footnote',
  'reference',
  'table',
  'formula',
  'algorithm',
  'gap',
] as const

export type PaperTaskSourceKind = (typeof PAPER_TASK_SOURCE_KINDS)[number]
export type PaperTaskSourceStatus = 'complete' | 'incomplete' | 'needs-confirmation'
export type PaperTaskRecordState = 'present' | 'missing' | 'ambiguous' | 'unrecovered'

export type PaperTaskSourceLink = {
  readonly kind: 'original' | 'reference'
  readonly url: string
}

export type PaperTaskSourceRecord = {
  readonly id: string
  readonly order: number
  readonly kind: PaperTaskSourceKind
  readonly text: string
  readonly state: PaperTaskRecordState
  readonly page: number
  readonly bbox: readonly [number, number, number, number]
  readonly sectionId: string | null
  readonly context: string
  readonly links: readonly PaperTaskSourceLink[]
}

export type PaperTaskSource = {
  readonly status: PaperTaskSourceStatus
  readonly pageCount: number
  readonly records: readonly PaperTaskSourceRecord[]
}

export type PaperTaskSourceAsset = {
  readonly recordId: string
  readonly page: number
  readonly bbox: readonly [number, number, number, number]
  readonly availability: 'available' | 'unavailable'
  readonly understanding: 'unverified'
  readonly mediaType: 'image/png'
  readonly bytes: Uint8Array | null
}

export type PaperTaskSourceFailureCode = 'empty-input' | 'invalid-pdf' | 'encrypted' | 'read-failed' | 'cancelled'

export type PaperTaskSourceResult =
  | { readonly success: true; readonly source: PaperTaskSource; readonly assets: readonly PaperTaskSourceAsset[] }
  | { readonly success: false; readonly error: { readonly code: PaperTaskSourceFailureCode } }
