/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskWorkspace } from '../../server/paper-task/workspace'
import { createPaperTaskSourceStore } from '../../server/paper-task/source-store'
import type { PaperTaskSource } from '../../app/utils/paper-task-source-contract'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'paper-md-'))
  roots.push(root)
  createPaperTaskWorkspace(root, new Uint8Array(Buffer.from('%PDF-1.4\nfixture')))
  const source: PaperTaskSource = {
    status: 'incomplete', pageCount: 2, records: [
      { id: 'p1-r0', order: 0, kind: 'body', text: 'Original evidence 47.5%. 中文😀', state: 'present', page: 1, bbox: [0, 0, 1, 1], sectionId: null, context: 'Duplicated context not needed by AI', links: [] },
      { id: 'p2-r1', order: 1, kind: 'gap', text: '', state: 'unrecovered', page: 2, bbox: [0, 0, 1, 1], sectionId: null, context: '', links: [] },
    ],
  }
  return { root, source, store: createPaperTaskSourceStore() }
}

describe('canonical source Markdown preparation', () => {
  it('materializes faithful page-anchored Markdown once without a txt cache or record JSON in the document', () => {
    const { root, source, store } = fixture()
    store.save('task', root, source, [])

    const markdown = readFileSync(join(root, 'source.md'), 'utf8')
    const metadata = JSON.parse(readFileSync(join(root, 'source.meta.json'), 'utf8'))

    expect(markdown).toContain('Original evidence 47.5%. 中文😀')
    expect(markdown).toContain('## Page 1')
    expect(markdown).toContain('## Page 2')
    expect(markdown).toContain('extraction gap')
    expect(markdown).not.toContain('Duplicated context')
    expect(markdown).not.toContain('p1-r0')
    expect(markdown).not.toContain('bbox')
    expect(readdirSync(root).some(name => name.endsWith('.txt'))).toBe(false)
    expect(metadata).toMatchObject({ version: 1, sourceRevision: 1, pageCount: 2, sourceStatus: 'incomplete' })
    expect(metadata.byteLength).toBe(Buffer.byteLength(markdown))
    const modified = statSync(join(root, 'source.md')).mtimeMs
    store.save('task', root, source, [])
    expect(statSync(join(root, 'source.md')).mtimeMs).toBe(modified)
  })

  it('refreshes the source snapshot on correction without changing the original PDF', () => {
    const { root, source, store } = fixture()
    store.save('task', root, source, [])
    const prior = JSON.parse(readFileSync(join(root, 'source.meta.json'), 'utf8'))
    const first = source.records[0]
    if (first === undefined) throw new Error('fixture record missing')
    const changed = { ...first, text: 'Corrected original evidence 47.5%. 中文😀' }
    store.replace('task', root, { ...source, records: [changed, ...source.records.slice(1)] }, [{ record: changed, revision: 2 }], 2)

    const next = JSON.parse(readFileSync(join(root, 'source.meta.json'), 'utf8'))

    expect(next.sourceRevision).toBe(2)
    expect(next.fingerprint).not.toBe(prior.fingerprint)
    expect(next.pdfSha256).toBe(prior.pdfSha256)
    expect(readFileSync(join(root, 'source.md'), 'utf8')).toContain('Corrected original evidence')
  })

  it('does not reuse a tampered source snapshot', () => {
    const { root, source, store } = fixture()
    store.save('task', root, source, [])
    writeFileSync(join(root, 'source.md'), 'tampered')

    expect(() => store.save('task', root, source, [])).toThrow()
  })

  it.each([
    ['records', []],
    ['pageCount', 10],
    ['sourceStatus', 'complete'],
  ])('rejects source metadata with altered %s outside its preparation fingerprint', (field, value) => {
    const { root, source, store } = fixture()
    store.save('task', root, source, [])
    const metadataPath = join(root, 'source.meta.json')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    metadata[field] = value
    writeFileSync(metadataPath, JSON.stringify(metadata))

    expect(() => store.save('task', root, source, [])).toThrow()
  })
})
