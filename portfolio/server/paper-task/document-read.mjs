import { completeDocumentRanges } from './document-artifact.mjs'

export function documentPage({ text, file, sha256, args = {}, extra = {} }) {
  const bytes = Buffer.from(text, 'utf8')
  const offset = args.offset ?? 0
  const limit = args.limit_bytes ?? 200000
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength
    || !Number.isSafeInteger(limit) || limit < 4 || limit > 200000) throw new Error('document page requires a valid UTF-8 offset and limit_bytes from 4 to 200000')
  if (offset < bytes.byteLength && (bytes[offset] & 0xc0) === 0x80) throw new Error('document cursor must be a UTF-8 boundary')
  let end = Math.min(offset + limit, bytes.byteLength)
  while (end > offset && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--
  const header = { file, offset, nextOffset: end, totalBytes: bytes.byteLength, sha256, ...extra }
  return { text: `${JSON.stringify(header)}\n\n${bytes.subarray(offset, end).toString('utf8')}`, start: offset, end, total: bytes.byteLength }
}

export function trackDocumentRead(previous, page, sha256) {
  if (previous !== undefined && previous.sha256 !== sha256) throw new Error('document changed between page reads')
  const ranges = [...(previous?.ranges ?? []), [page.start, page.end]]
  return { ranges, sha256, complete: completeDocumentRanges(ranges, page.total) }
}

export function missingDocumentOffset(receipt) {
  let offset = 0
  for (const [start, end] of [...(receipt?.ranges ?? [])].sort((left, right) => left[0] - right[0])) {
    if (start > offset) break
    offset = Math.max(offset, end)
  }
  return offset
}
