/**
 * Reusable generator for the paper-review sample PDF fixture.
 *
 * Uses only Node built-ins (node:fs). Emits a minimal but valid single-font
 * PDF with one text line per source line, laid out top-to-bottom. Deterministic
 * output: no timestamps or random ids are embedded.
 *
 * The fixture is a synthetic test artifact, not a real paper. Its heading lines
 * are numbered ("1 Introduction", ...) so the extractor's structural heading
 * detector fires exactly on them, and it carries known quotes that downstream
 * verification compares verbatim.
 *
 * Regenerate with:
 *   node tests/fixtures/generate-paper-review-sample.mjs
 * It writes tests/fixtures/paper-review-sample.pdf and prints object offsets.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FONT_SIZE = 12
const LINE_STEP = 24
const TOP_MARGIN = 760
const LEFT_MARGIN = 72

/**
 * The pages of the fixture, in reader order. Lines are either strings or
 * positioned text runs for exercising PDF text-layout reconstruction.
 */
export const SAMPLE_PAGES = [
  {
    lines: [
      '1 Introduction',
      'Portable Document Format files preserve layout for print.',
      'This synthetic fixture is not a real academic paper.',
      'The quick brown fox jumps over the lazy dog.',
      'Precomputed baselines anchor the expected extraction values.',
    ],
  },
  {
    lines: [
      '2 Methods',
      'We measured response latency with a calibrated timer.',
      'Sample sizes were determined a priori.',
      'Each trial ran in full isolation from prior trials.',
    ],
  },
  {
    lines: [
      '3 Results',
      'Accuracy improved from 71.2% to 92.4% after tuning.',
      'A shorter quote spans the sentence boundary.',
    ],
  },
]

/** Escape a literal string for a PDF string object ((...)). */
function escapePdfString(value) {
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (ch === '(') {
      out += '\\('
    } else if (ch === ')') {
      out += '\\)'
    } else if (ch === '\\') {
      out += '\\\\'
    } else if (code < 32 || code > 126) {
      out += '\\' + code.toString(8).padStart(3, '0')
    } else {
      out += ch
    }
  }
  return out
}

/** Wrap a raw content stream body with a length-prefixed PDF stream object. */
function streamObject(encoder, body) {
  const head = encoder.encode(`<< /Length ${body.length} >>\nstream\n`)
  const tail = encoder.encode('\nendstream')
  const bytes = new Uint8Array(head.length + body.length + tail.length)
  bytes.set(head, 0)
  bytes.set(body, head.length)
  bytes.set(tail, head.length + body.length)
  return bytes
}

/**
 * Build one page content stream. Each line is its own BT/ET text block so the
 * extractor can reconstruct visual lines reliably without external font data.
 */
function buildPageContent(lines) {
  let y = TOP_MARGIN
  const blocks = []
  for (const line of lines) {
    const runs = typeof line === 'string' ? [{ text: line }] : line.runs
    for (const run of runs) {
      const x = run.x ?? LEFT_MARGIN
      const block = `BT\n/F1 ${FONT_SIZE} Tf\n${x} ${y} Td (${escapePdfString(run.text)}) Tj\nET`
      blocks.push(block)
    }
    y -= LINE_STEP
  }
  return new TextEncoder().encode(blocks.join('\n'))
}

/** Identity ASCII ToUnicode CMap body (maps byte 0x20..0x7e to ASCII). */
function toUnicodeCmapBody() {
  const ranges = []
  for (let code = 0x20; code <= 0x7e; code += 1) {
    const unicode = String.fromCharCode(code)
      .charCodeAt(0)
      .toString(16)
      .padStart(4, '0')
    ranges.push(`<${code.toString(16).padStart(2, '0')}> <${unicode}>`)
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n`
    + `/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n`
    + `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <ff>\nendcodespacerange\n`
    + `${ranges.length} beginbfchar\n${ranges.join('\n')}\nendbfchar\n`
    + `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`
}

/**
 * Assemble a minimal multi-page PDF from a list of page line arrays and return
 * its bytes as a Uint8Array. The fixture embeds its own font metrics (Widths,
 * descriptor, ToUnicode CMap) and uses a non-standard font name, so text
 * extraction needs no external font or CMAP data.
 */
export function buildSamplePdf(pages) {
  const encoder = new TextEncoder()
  const objects = [] // [bytes] pushed in object-number order
  const pageNumbers = []
  const contentNumbers = []

  // Object 1: catalog, 2: pages, then (page, content) pairs, then font,
  // font descriptor, and ToUnicode CMap.
  pages.forEach((page, index) => {
    pageNumbers.push(3 + index * 2)
    contentNumbers.push(4 + index * 2)
  })
  const fontNumber = 3 + pages.length * 2
  const descriptorNumber = fontNumber + 1
  const toUnicodeNumber = fontNumber + 2

  objects[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>')
  const kids = pageNumbers.map((n) => `${n} 0 R`).join(' ')
  objects[2] = encoder.encode(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  for (let i = 0; i < pages.length; i += 1) {
    objects[contentNumbers[i]] = streamObject(encoder, buildPageContent(pages[i].lines))
    objects[pageNumbers[i]] = encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]`
        + ` /Contents ${contentNumbers[i]} 0 R`
        + ` /Resources << /Font << /F1 ${fontNumber} 0 R >> >> >>`,
    )
  }
  const widths = Array.from({ length: 95 }, () => 520).join(' ')
  objects[fontNumber] = encoder.encode(
    `<< /Type /Font /Subtype /Type1 /BaseFont /FixtureSans /Encoding /WinAnsiEncoding`
      + ` /FirstChar 32 /LastChar 126 /Widths [${widths}]`
      + ` /FontDescriptor ${descriptorNumber} 0 R /ToUnicode ${toUnicodeNumber} 0 R >>`,
  )
  objects[descriptorNumber] = encoder.encode(
    '<< /Type /FontDescriptor /FontName /FixtureSans /Flags 4 /FontBBox [0 -250 1000 900]'
      + ' /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 /MissingWidth 520 >>',
  )
  objects[toUnicodeNumber] = streamObject(encoder, new TextEncoder().encode(toUnicodeCmapBody()))

  // Serialize with a correct xref table.
  const body = []
  const offsets = [0] // index 0 unused (xref entry 0 is the free head)
  let offset = 0
  for (let number = 1; number <= toUnicodeNumber; number += 1) {
    const header = encoder.encode(`${number} 0 obj\n`)
    const tail = encoder.encode('\nendobj\n')
    offsets[number] = offset
    offset += header.length
    body.push(header)
    body.push(objects[number])
    offset += objects[number].length
    body.push(tail)
    offset += tail.length
  }

  const trailerDict = `<< /Size ${toUnicodeNumber + 1} /Root 1 0 R >>`
  const xref = `xref\n0 ${toUnicodeNumber + 1}\n0000000000 65535 f \n`
    + Array.from(
        { length: toUnicodeNumber },
        (_, i) => String(offsets[i + 1]).padStart(10, '0') + ' 00000 n \n',
      ).join('')

  const head = encoder.encode('%PDF-1.4\n')
  const xrefBytes = encoder.encode(xref)
  const trailer = encoder.encode(`trailer\n${trailerDict}\nstartxref\n${offset}\n%%EOF\n`)

  const result = new Uint8Array(head.length + offset + xrefBytes.length + trailer.length)
  let cursor = 0
  const write = (chunk) => {
    result.set(chunk, cursor)
    cursor += chunk.length
  }
  write(head)
  for (const chunk of body) {
    write(chunk)
  }
  write(xrefBytes)
  write(trailer)
  return result
}

// CLI entrypoint (skipped when imported as a module by tests).
const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outPath = join(here, 'paper-review-sample.pdf')
  const bytes = buildSamplePdf(SAMPLE_PAGES)
  writeFileSync(outPath, bytes)
  console.log(`Wrote ${outPath} (${bytes.length} bytes, ${SAMPLE_PAGES.length} pages)`)
}
