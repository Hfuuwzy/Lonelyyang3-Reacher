import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { readBytes } from './controlled-files.mjs'

const MAX_RESPONSE_CHARACTERS = 8000
const MAX_RESPONSE_BYTES = 20000
const MAX_RECORD_BYTES = 2000000

export async function readSourceBatch({ sourceRoot, ids, indexBytes, args }) {
  const index = args.index_offset ?? 0
  const offset = args.offset ?? 0
  const recordLimit = args.record_limit ?? 50
  const byteLimit = args.limit_bytes ?? 20000
  if (!Number.isSafeInteger(index) || index < 0 || index > ids.length
    || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(recordLimit) || recordLimit < 1 || recordLimit > 50
    || !Number.isSafeInteger(byteLimit) || byteLimit < 4 || byteLimit > 20000) throw new Error('source batch cursor or limits are invalid')
  if (index === ids.length && offset !== 0) throw new Error('completed source batch cursor must use offset 0')
  const items = []
  const reads = []
  const indexSha256 = hash(indexBytes)
  let nextIndex = index
  let nextOffset = offset
  let usedBytes = 0
  const serialize = (candidateItems, candidateIndex, candidateOffset) => JSON.stringify({
    indexOffset: index, offset, indexSha256, totalItems: ids.length,
    items: candidateItems, nextIndex: candidateIndex, nextOffset: candidateOffset,
  })
  let page = serialize(items, nextIndex, nextOffset)

  while (nextIndex < ids.length && items.length < recordLimit && byteLimit - usedBytes >= 4) {
    const id = ids[nextIndex]
    const bytes = await readBytes(sourceRoot, resolve(sourceRoot, `${id}.json`), MAX_RECORD_BYTES)
    if (nextOffset > bytes.byteLength) throw new Error('source batch byte offset is outside the file')
    if (nextOffset < bytes.byteLength && (bytes[nextOffset] & 0xc0) === 0x80) throw new Error('source batch byte offset must be a UTF-8 boundary')
    const start = nextOffset
    let end = Math.min(start + byteLimit - usedBytes, bytes.byteLength)
    let item, candidate, candidateIndex, candidateOffset
    while (true) {
      while (end > start && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--
      item = { record_id: id, offset: start, nextOffset: end, totalBytes: bytes.byteLength, text: bytes.subarray(start, end).toString('utf8') }
      candidateIndex = end === bytes.byteLength ? nextIndex + 1 : nextIndex
      candidateOffset = end === bytes.byteLength ? 0 : end
      candidate = serialize([...items, item], candidateIndex, candidateOffset)
      if (candidate.length <= MAX_RESPONSE_CHARACTERS && Buffer.byteLength(candidate, 'utf8') <= MAX_RESPONSE_BYTES) break
      end = start + Math.floor((end - start) / 2)
      if (end <= start) break
    }
    if (end <= start && bytes.byteLength > start) {
      if (items.length === 0) throw new Error('source batch cannot fit one source character')
      break
    }
    items.push(item)
    reads.push({ id, start, end, total: bytes.byteLength, sha256: hash(bytes) })
    page = candidate
    usedBytes += end - start
    nextIndex = candidateIndex
    nextOffset = candidateOffset
    if (nextOffset !== 0) break
  }
  return { page, reads, firstIndex: index, discoveredEnd: items.length === 0 ? index : nextIndex + (nextOffset === 0 ? 0 : 1) }
}

export function inspectSourceCoverage({ ids, indexBytes, indexRead, sourceReads, submittedIds }) {
  const unread = ids.filter((id) => sourceReads.get(id)?.complete !== true)
  const submitted = new Set(Array.isArray(submittedIds) ? submittedIds : [])
  const missingSubmitted = ids.filter((id) => !submitted.has(id))
  const firstUnread = unread[0]
  let nextOffset = 0
  for (const [start, end] of sourceReads.get(firstUnread)?.ranges ?? []) {
    if (start > nextOffset) break
    nextOffset = Math.max(nextOffset, end)
  }
  return {
    version: 1, indexSha256: hash(indexBytes),
    indexComplete: indexRead?.complete === true && indexRead.sha256 === hash(indexBytes),
    totalRecords: ids.length, fullyReadRecords: ids.length - unread.length,
    unreadCount: unread.length, unreadSample: unread.slice(0, 20),
    nextIndex: firstUnread === undefined ? ids.length : ids.indexOf(firstUnread), nextOffset,
    submittedCount: Array.isArray(submittedIds) ? submittedIds.length : 0,
    missingSubmittedCount: missingSubmitted.length, missingSubmittedSample: missingSubmitted.slice(0, 20),
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
