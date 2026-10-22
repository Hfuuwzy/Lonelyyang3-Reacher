/**
 * Reusable generator for the two-column paper-review PDF fixture.
 *
 * Reuses the installed fixture builder (generate-paper-review-sample.mjs),
 * which emits a valid single-font PDF with one text line per source line.
 * This generator models a realistic academic page:
 *
 *   - a full-width single-column header (title, authors, Abstract) at the top,
 *   - a full-width section heading band,
 *   - a two-column body where every row shares one baseline: each row is one
 *     y coordinate carrying two text runs (left column + right column),
 *   - full-width References and Appendix A bands after the columns.
 *
 * Deterministic: no timestamps or random ids are embedded. The PDF bytes are
 * valid and extractable by the installed PDF.js build.
 *
 * Regenerate with:
 *   node tests/fixtures/generate-paper-review-columns.mjs
 * It writes tests/fixtures/paper-review-columns.pdf and prints object offsets.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSamplePdf } from './generate-paper-review-sample.mjs'

// Column geometry. Both columns start at their own left edge but every row
// below shares the same baseline (same y coordinate in the content stream).
const LEFT_X = 72
const RIGHT_X = 340

/** Full-width single-column header lines, in reading order. */
export const COLUMN_PAPER_HEADER_LINES = [
  'Two-Column Academic Layout Reconstruction',
  'Alice Example, Bob Sample, Carol Test',
  'Abstract',
  'We describe a synthetic two-column PDF fixture used to exercise reading-order',
  'reconstruction from raw coordinates. The title and abstract are full width,',
  'while the body below splits into two columns that share their baselines.',
  'Keywords: pdf extraction; two-column layout; reading order',
  '1 Introduction',
]

/** Left-column body lines, top to bottom. */
export const COLUMN_PAPER_LEFT_LINES = [
  'Two-column text keeps lines short',
  'and readable; both sides share a',
  'common baseline on every wrapped',
  'row, so a horizontal scan crosses',
  'both columns in a single band of',
  'Figure 1. Baseline-aligned rows',
  'ease reading-order recovery from',
  'Table 1. Extraction accuracy',
  'Method    Accuracy',
  'Baseline  92.4%',
  'Naive     71.2%',
  'E = m c^2',
]

/** Right-column body lines, top to bottom. */
export const COLUMN_PAPER_RIGHT_LINES = [
  'Right-column prose is independent',
  'text that nevertheless shares each',
  'baseline with the left column rows,',
  'letting the extractor group them by',
  'the vertical coordinate alone.',
  'Captions are ordinary text and need',
  'no special handling to be located.',
  'Table rows use whitespace, not pipes,',
  'so column splits come from x values.',
  'Numbers stay exact and untranslated.',
  'References and the appendix appear',
  'after the columns as full-width bands.',
]

/** Full-width trailing bands after the two-column body. */
export const COLUMN_PAPER_TAIL_LINES = [
  'References',
  '[1] A. Example, B. Sample, C. Test. Reading Order from Coordinates. 2024.',
  'Appendix A',
  'Appendix content is ordinary text with no special markup.',
]

/**
 * Expected reading order, hardcoded independently of the content stream:
 * full-width header, then the whole left column top-to-bottom, then the whole
 * right column top-to-bottom, then the trailing full-width bands.
 */
export const expectedColumnPaperLines = [
  ...COLUMN_PAPER_HEADER_LINES,
  ...COLUMN_PAPER_LEFT_LINES,
  ...COLUMN_PAPER_RIGHT_LINES,
  ...COLUMN_PAPER_TAIL_LINES,
]

/**
 * Assemble the fixture page. Header and tail lines are full-width strings;
 * each body row is a pair of positioned runs sharing one baseline.
 */
function buildColumnPageLines() {
  const lines = [...COLUMN_PAPER_HEADER_LINES]
  for (let i = 0; i < COLUMN_PAPER_LEFT_LINES.length; i += 1) {
    lines.push({
      runs: [
        { text: COLUMN_PAPER_LEFT_LINES[i], x: LEFT_X },
        { text: COLUMN_PAPER_RIGHT_LINES[i], x: RIGHT_X },
      ],
    })
  }
  lines.push(...COLUMN_PAPER_TAIL_LINES)
  return lines
}

/** Return the two-column paper fixture as a PDF Uint8Array. */
export function buildColumnPaperPdf() {
  return buildSamplePdf([{ lines: buildColumnPageLines() }])
}

// CLI entrypoint (skipped when imported as a module by tests).
const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outPath = join(here, 'paper-review-columns.pdf')
  const bytes = buildColumnPaperPdf()
  writeFileSync(outPath, bytes)
  console.log(`Wrote ${outPath} (${bytes.length} bytes, 1 page)`)
}
