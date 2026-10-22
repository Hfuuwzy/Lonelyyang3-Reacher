import { describe, expect, it } from 'vitest'
import { isHeadingLine } from '../../server/utils/paper-review/pdf'

describe('academic PDF heading sanity', () => {
  it.each([
    '1 \u2217 2 \u2217',
    '3 3 1',
    '0.8400 0.8685 0.7484 0.7062 0.7603',
    '2019. code2seq: Generating sequences from structured representations.',
  ])('keeps non-heading source line %s out of the chapter list', (line) => {
    // Given author markers, metric rows, or a dated reference entry.
    // When the structural heading guard examines the exact source line.
    const heading = isHeadingLine(line)
    // Then numeric prefixes alone do not create chapter headings.
    expect(heading).toBe(false)
  })

  it.each(['1 Introduction', '2.2 Multi-Modal Pre-Trained Models'])('recognizes academic section %s', (line) => {
    // Given an ordinary numbered section title.
    // When the same guard examines the line.
    const heading = isHeadingLine(line)
    // Then legitimate numbered titles remain available for provenance.
    expect(heading).toBe(true)
  })
})
