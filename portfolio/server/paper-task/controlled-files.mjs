import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function assertContained(root, path) {
  const pathFromRoot = relative(root, path)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) throw new Error('paper task path is outside the assigned directory')
}

export async function readBytes(root, path, maxBytes) {
  const actualRoot = await realpath(root)
  const actualPath = await realpath(path)
  assertContained(actualRoot, actualPath)
  if ((await lstat(actualPath)).size > maxBytes) throw new Error('paper task file exceeds its read limit')
  const bytes = await readFile(actualPath)
  if (bytes.byteLength > maxBytes) throw new Error('paper task file exceeds its read limit')
  return bytes
}

export async function readPage(root, path, offset, maxBytes, maxFileBytes) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 20000) throw new Error('page limits are invalid: use offset >= 0 and limit_bytes from 4 to 20000, or omit both for the first page')
  const bytes = await readBytes(root, path, maxFileBytes)
  if (offset > bytes.byteLength) throw new Error('page offset is outside the file')
  let start = offset
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start++
  let end = Math.min(start + maxBytes, bytes.byteLength)
  while (end > start && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--
  return { bytes, page: JSON.stringify({ offset: start, nextOffset: end, totalBytes: bytes.byteLength, text: bytes.subarray(start, end).toString('utf8') }), start, end }
}

export async function writeOwnedFile(directory, filename, contents) {
  const outputDirectory = await realpath(directory)
  const path = resolve(outputDirectory, filename)
  if (relative(outputDirectory, path).startsWith('..') || isAbsolute(relative(outputDirectory, path))) throw new Error('branch output path is invalid')
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink() || !details.isFile()) throw new Error('branch output path is invalid')
    assertContained(outputDirectory, await realpath(path))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = resolve(outputDirectory, `.${filename}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    try { await unlink(temporary) } catch (cleanupError) {
      if (!(cleanupError instanceof Error) || !('code' in cleanupError) || cleanupError.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }
}
