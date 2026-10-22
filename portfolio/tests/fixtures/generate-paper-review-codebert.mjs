/**
 * Reusable generator for CodeBERT-derived two-column layout fixtures.
 *
 * Models the real CodeBERT paper (arXiv 2002.08155) geometry that the region
 * detector must handle:
 *
 *   - a narrow ~15px column gutter (left column ends ~290, right column starts
 *     ~307), far below the old fixed 40px per-row gap heuristic,
 *   - rows that share no baseline pair (asymmetric baselines, so no same-row
 *     left/right pairing exists),
 *   - a full-width table whose cells align across many rows (row-major output),
 *   - a column-local numbered heading that must NOT flush as a full-width band,
 *   - a metric row ("0.8400 0.8685 0.7484") that must never become a heading.
 *
 * Deterministic: reuses the installed fixture builder, no timestamps/ids.
 */

import { buildSamplePdf } from './generate-paper-review-sample.mjs'

const LEFT_X = 72
const RIGHT_X = 307

/** Expected reading order for the narrow-gutter asymmetric-baseline page. */
export const expectedNarrowGutterLines = [
  '1 Introduction',
  'Left column line one continues to',
  'Left column wraps over here',
  '0.8400 0.8685 0.7484',
  'Left column paragraph ends.',
  'Right column line one',
  'Right column keeps its own prose',
  'Right column paragraph ends.',
]

/** Build the narrow-gutter asymmetric-baseline CodeBERT-like page. */
export function buildNarrowGutterPdf() {
  return buildSamplePdf([{
    lines: [
      '1 Introduction',
      { runs: [{ text: 'Left column line one continues to', x: LEFT_X }] },
      { runs: [{ text: 'Right column line one', x: RIGHT_X }] },
      { runs: [{ text: 'Left column wraps over here', x: LEFT_X }] },
      { runs: [{ text: 'Right column keeps its own prose', x: RIGHT_X }] },
      { runs: [{ text: '0.8400 0.8685 0.7484', x: LEFT_X }] },
      { runs: [{ text: 'Left column paragraph ends.', x: LEFT_X }] },
      { runs: [{ text: 'Right column paragraph ends.', x: RIGHT_X }] },
    ],
  }])
}

/** Full-width table cells share the same x columns so their alignment recurs. */
const TABLE_COLS = [227, 297, 342, 381, 420, 455, 489]

function tableRow(label, values) {
  const runs = [{ text: label, x: 84 }]
  values.forEach((value, index) => runs.push({ text: value, x: TABLE_COLS[index] }))
  return { runs }
}

/** Expected reading order for the full-width-table + prose page. */
export const expectedCodebertTableLines = [
  'RUBY JAVASCRIPT GO PYTHON JAVA PHP ALL',
  'RoBERTa 73.68 63.97 72.37 59.18 59.96 69.78 62.45',
  'CodeBERT 71.05 77.94 89.47 70.41 70.12 82.31 74.11',
  'Table 3: Statistics of the data used in the probing evaluation.',
  '3.5 Fine-Tuning CodeBERT',
  'Left prose under the table',
  'Left prose continues.',
  'Right prose starts',
  'Right prose continues.',
]

/** Build the full-width-table + column-prose CodeBERT-like page. */
export function buildCodebertTablePdf() {
  return buildSamplePdf([{
    lines: [
      tableRow('RUBY', ['JAVASCRIPT', 'GO', 'PYTHON', 'JAVA', 'PHP', 'ALL']),
      tableRow('RoBERTa', ['73.68', '63.97', '72.37', '59.18', '59.96', '69.78', '62.45']),
      tableRow('CodeBERT', ['71.05', '77.94', '89.47', '70.41', '70.12', '82.31', '74.11']),
      { runs: [{ text: 'Table 3: Statistics of the data used in the probing evaluation.', x: 72 }] },
      '3.5 Fine-Tuning CodeBERT',
      { runs: [{ text: 'Left prose under the table', x: LEFT_X }] },
      { runs: [{ text: 'Left prose continues.', x: LEFT_X }] },
      { runs: [{ text: 'Right prose starts', x: RIGHT_X }] },
      { runs: [{ text: 'Right prose continues.', x: RIGHT_X }] },
    ],
  }])
}
