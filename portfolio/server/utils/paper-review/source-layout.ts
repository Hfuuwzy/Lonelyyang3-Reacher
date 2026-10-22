/**
 * Layout geometry for the paper-review extractor (issue #27/#29).
 *
 * A `PaperTextRun` is the raw, page-labelled text-run geometry that the
 * column-aware page reconstruction consumes. Indiscriminate raw-ordering and
 * fixed-gap "layout ambiguity" warnings are intentionally removed here: the
 * application reconstructs reading order from bounded column regions and
 * full-width bands (see `pdf-page`), and any genuinely ambiguous region is
 * locked to `unresolved` at the candidate layer rather than flagged page-wide.
 */

export interface PaperTextRun {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly horizontal: boolean
  /** The source font identity, retained when pdfjs exposes it. */
  readonly font?: string
  /** The run's cap height in PDF units, retained when pdfjs exposes it. */
  readonly height?: number
}
