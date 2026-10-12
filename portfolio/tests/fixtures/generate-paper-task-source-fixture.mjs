import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const encoder = new TextEncoder()
const objects = []

function add(body) {
  objects.push(typeof body === 'string' ? encoder.encode(body) : body)
  return objects.length
}

function stream(content) {
  const bytes = encoder.encode(content)
  const head = encoder.encode(`<< /Length ${bytes.length} >>\nstream\n`)
  const tail = encoder.encode('\nendstream')
  const result = new Uint8Array(head.length + bytes.length + tail.length)
  result.set(head)
  result.set(bytes, head.length)
  result.set(tail, head.length + bytes.length)
  return result
}

function textLine(value, x, y, size = 12) {
  const safe = value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  return `BT /F1 ${size} Tf ${x} ${y} Td (${safe}) Tj ET`
}

const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
const pageSpecs = [
  {
    lines: [
      textLine('1 Overview', 72, 730, 18),
      textLine('The proposed method preserves 47.5% accuracy under shift.', 72, 690),
      textLine('See [1] for the data source.', 72, 650),
      textLine('2 Measurements', 72, 580, 18),
      textLine('Observed values are not estimates.', 72, 540),
      textLine('Left column statement.', 72, 500), textLine('Right column statement.', 360, 500),
      textLine('Left column continuation.', 72, 476), textLine('Right column continuation.', 360, 476),
    ],
    annotation: true,
  },
  {
    lines: [
      textLine('Table 1: Measurements (units)', 72, 730),
      textLine('Group', 72, 700), textLine('Count', 260, 700), textLine('Rate', 430, 700),
      textLine('Control', 72, 676), textLine('120', 260, 676), textLine('47.5%', 430, 676),
      textLine('Method', 72, 652), textLine('115', 260, 652), textLine('52.0%', 430, 652),
      textLine('Notes: percentages use the full cohort.', 72, 626, 10),
       textLine('The relation is defined as follows.', 72, 600),
       textLine('E = m c^2 (1)', 72, 570),
      textLine('Algorithm 1: Stable update', 72, 520),
      textLine('1. Initialize parameter vector.', 92, 496),
      textLine('2. Update using the measured gradient.', 92, 472),
      textLine('References', 72, 420, 16),
      textLine('[1] Example, Data source. 2024.', 72, 392),
      textLine('Appendix A', 72, 330, 16),
      textLine('Additional derivation retains the 47.5% value.', 72, 300),
      textLine('1 Footnote: baseline is defined on page 1.', 72, 60, 9),
      textLine('Table 2: Caption only', 72, 220),
    ],
    internalAnnotation: true,
  },
  { lines: [] },
]

const pageObjects = []
for (const spec of pageSpecs) {
  const contents = add(stream(spec.lines.join('\n')))
  const annotations = spec.annotation ? [
    add('<< /Type /Annot /Subtype /Link /Rect [70 638 230 662] /Border [0 0 0] /A << /S /URI /URI (https://example.org/data) >> >>'),
    add('<< /Type /Annot /Subtype /Link /Rect [70 638 230 662] /Border [0 0 0] /A << /S /URI /URI (javascript:alert(1)) >> >>'),
  ] : []
  if (spec.internalAnnotation) {
    annotations.push(add('<< /Type /Annot /Subtype /Link /Rect [70 560 180 580] /Border [0 0 0] /A << /S /GoTo /D (equation) >> >>'))
  }
  const annotRef = annotations.length === 0 ? '' : ` /Annots [${annotations.map((annotation) => `${annotation} 0 R`).join(' ')}]`
  pageObjects.push(add(`<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R${annotRef} >>`))
}

const pages = add('')
for (const page of pageObjects) {
  const object = objects[page - 1]
  const body = new TextDecoder().decode(object).replace('PAGES', `${pages} 0 R`)
  objects[page - 1] = encoder.encode(body)
}
objects[pages - 1] = encoder.encode(`<< /Type /Pages /Kids [${pageObjects.map((page) => `${page} 0 R`).join(' ')}] /Count ${pageObjects.length} >>`)
const equationPage = pageObjects[1]
const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R /Names << /Dests << /Names [(equation) [${equationPage} 0 R /Fit]] >> >> >>`)

const chunks = [encoder.encode('%PDF-1.4\n')]
const offsets = [0]
let offset = chunks[0].length
objects.forEach((body, index) => {
  offsets.push(offset)
  const chunk = encoder.encode(`${index + 1} 0 obj\n`)
  const end = encoder.encode('\nendobj\n')
  chunks.push(chunk, body, end)
  offset += chunk.length + body.length + end.length
})
const xrefOffset = offset
const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}`
const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
chunks.push(encoder.encode(xref + trailer))
const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
let cursor = 0
for (const chunk of chunks) {
  bytes.set(chunk, cursor)
  cursor += chunk.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('./paper-task-source-fixture.pdf', import.meta.url), bytes)
}
