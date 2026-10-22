import { buildSamplePdf } from './generate-paper-review-sample.mjs'

export const expectedUnevenColumnLines = [
  'Full-width academic heading crosses the central gutter',
  'Left paragraph starts',
  'Left-only continuation',
  'Left paragraph ends.',
  'Right paragraph starts',
  'Right paragraph continues',
  'Right-only ending.',
  'Full-width final heading crosses the central gutter',
]

export function buildUnevenColumnPdf() {
  return buildSamplePdf([{
    lines: [
      'Full-width academic heading crosses the central gutter',
      { runs: [
        { text: 'Left paragraph starts', x: 72 },
        { text: 'Right paragraph starts', x: 340 },
      ] },
      { runs: [{ text: 'Left-only continuation', x: 72 }] },
      { runs: [
        { text: 'Left paragraph ends.', x: 72 },
        { text: 'Right paragraph continues', x: 340 },
      ] },
      { runs: [{ text: 'Right-only ending.', x: 340 }] },
      'Full-width final heading crosses the central gutter',
    ],
  }])
}
