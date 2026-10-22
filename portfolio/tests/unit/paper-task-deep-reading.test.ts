import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupDocumentFixtures, documentFixture, DOCUMENT_MANUSCRIPT, DOCUMENT_TASK_ID } from '../fixtures/paper-task-document'
import { readDocumentArtifact } from '../../server/paper-task/document-artifact.mjs'
import { evaluateBranchQuality } from '../../server/paper-task/branch-quality'
import { readPaperTaskTranslation } from '../../server/paper-task/translation-access'

afterEach(cleanupDocumentFixtures)

describe('whole-document provenance for paper analysis', () => {
  it('does not mistake a complete delivery receipt for semantic claim verification or quality approval', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })

    const document = readDocumentArtifact(fixture.root, fixture.branch)
    expect(document.kind).toBe('document')
    if (document.kind !== 'document') throw new Error('document unavailable')
    expect(document.metadata.source.readComplete).toBe(true)
    expect(document.metadata.provenance).toBe('document-only')
    expect(evaluateBranchQuality(fixture.root, fixture.branch)).toMatchObject({ status: 'preview', reviewCompleted: false })
    expect(document.metadata.skill.resourcesRead.map(resource => resource.path)).toEqual(['SKILL.md'])
  })

  it.each(['translation', 'deep-reading'] as const)('marks the entire %s stale after a source correction while retaining its bytes', async (branch) => {
    const fixture = documentFixture({ branch })
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    const changed = { ...fixture.record, text: 'A longer corrected original source statement. '.repeat(30) }

    fixture.store.replace(DOCUMENT_TASK_ID, fixture.root, { ...fixture.source, records: [changed] }, [{ record: changed, revision: 2 }], 2)

    const document = readDocumentArtifact(fixture.root, branch)
    expect(document.kind).toBe('document')
    if (document.kind !== 'document') throw new Error('stale document disappeared')
    expect(document.stale).toBe(true)
    expect(document.markdown).toBe(DOCUMENT_MANUSCRIPT)
    expect(evaluateBranchQuality(fixture.root, branch).status).toBe('needs-confirmation')
    if (branch === 'translation') expect(readPaperTaskTranslation(DOCUMENT_TASK_ID, fixture.root)?.status).toBe('needs-update')
  })

  it('fails closed on an invalid v2 read receipt rather than falling back to record-era validators', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    const path = join(fixture.root, 'drafts', fixture.branch, 'evidence.json')
    const metadata = JSON.parse(readFileSync(path, 'utf8'))
    metadata.source.readRanges = []
    writeFileSync(path, JSON.stringify(metadata))

    expect(readDocumentArtifact(fixture.root, fixture.branch).kind).toBe('invalid')
    expect(evaluateBranchQuality(fixture.root, fixture.branch).status).toBe('failed')
  })
})
