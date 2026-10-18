import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readBytes, writeOwnedFile } from './controlled-files.mjs'
import { inspectTranslationMaster } from './translation-master.mjs'

const MAX_SOURCE_BYTES = 2_000_000

/**
 * Publishes a whole-paper translation master into the branch workspace. The
 * source index must be fully discovered and every indexed record completely
 * read before the ledger is accepted. Quality findings are retained with the
 * readable master instead of discarding it; the runtime gate decides whether
 * the branch can be complete.
 */
export async function publishTranslationMaster(context) {
  const { args, taskRoot, sourceRoot, branchRoot, indexedIds, sourceReads, sourceIndexRead, indexBytes } = context
  if (sourceIndexRead?.complete !== true || sourceIndexRead.sha256 !== hash(indexBytes)) {
    throw new Error('translation requires complete index discovery')
  }
  const storedSources = []
  for (const recordId of indexedIds) {
    const bytes = await readBytes(sourceRoot, join(sourceRoot, `${recordId}.json`), MAX_SOURCE_BYTES)
    if (hash(bytes) !== sourceReads.get(recordId)?.sha256) throw new Error('source record changed after it was read')
    const stored = JSON.parse(bytes.toString('utf8'))
    if (stored.record?.id !== recordId || !Number.isInteger(stored.revision) || stored.revision < 1) throw new Error('source record is unavailable')
    if (stored.record.kind !== 'gap' && sourceReads.get(recordId)?.complete !== true) {
      throw new Error('read every indexed source record completely before saving the translation')
    }
    storedSources.push(stored)
  }
  const state = JSON.parse((await readBytes(taskRoot, join(taskRoot, 'source-state.json'), MAX_SOURCE_BYTES)).toString('utf8'))
  const inspected = inspectTranslationMaster(args, {
    records: storedSources, state, indexIds: indexedIds, sourceRevision: state.revision,
  })
  await writeOwnedFile(branchRoot, 'master.md', inspected.markdown)
  await writeOwnedFile(branchRoot, 'preview.md', inspected.markdown)
  await writeOwnedFile(branchRoot, 'translation.json', JSON.stringify(inspected.metadata))
  return { message: 'Branch preview saved.', issues: inspected.issues, records: storedSources, state }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
