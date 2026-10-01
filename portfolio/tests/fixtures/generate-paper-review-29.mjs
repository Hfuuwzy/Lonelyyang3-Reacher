import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSamplePdf } from './generate-paper-review-sample.mjs'

// Independent fixture: importing the existing builder never runs its CLI.
export const PAPER_29_PAGES = [
  { lines: [
    '1 Introduction',
    'The calibrated system does not increase error',
    'when the temperature is 20 C.',
    'A second paragraph crosses the page boundary and',
  ] },
  { lines: [
    'continues without losing its negation or numbers: not 30%.',
    '2 Results',
    'Figure 1. Error decreases by 12% under calibration.',
    'Table 1. Measured accuracy, not predicted accuracy.',
    'Method | Accuracy',
    'Calibrated | 92.4%',
    'E = m c^2',
    'References',
    '[1] Example Author. Calibration. 2024.',
    'Appendix',
    'Additional derivations are outside the translation scope.',
  ] },
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('./paper-review-29.pdf', import.meta.url)
  const bytes = buildSamplePdf(PAPER_29_PAGES)
  writeFileSync(path, bytes)
  console.log(`Wrote paper-review-29.pdf (${bytes.length} bytes)`)
}
