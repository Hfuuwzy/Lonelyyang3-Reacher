/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupDocumentFixtures, documentFixture, DOCUMENT_CRITERIA, DOCUMENT_MANUSCRIPT } from '../fixtures/paper-task-document'
import { readDocumentArtifact } from '../../server/paper-task/document-artifact.mjs'
import { evaluateBranchQuality } from '../../server/paper-task/branch-quality'

afterEach(cleanupDocumentFixtures)

const findings = [{ code: 'evidence', severity: 'substantive', description: 'Narrow the conclusion.', target_indexes: [1], source_pages: [1] }]

async function reviewedFixture() {
  const fixture = documentFixture()
  await fixture.prepare()
  await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
  await fixture.call('paper_task_read_branch')
  await fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: 'Review completed.', findings })
  return fixture
}

describe('v2 document publication and review integrity', () => {
  it('keeps a source-corrected publication readable and marks it stale', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    const correctedRecord = { ...fixture.record, text: 'Corrected evidence.' }
    fixture.store.replace('123e4567-e89b-12d3-a456-426614174000', fixture.root, { ...fixture.source, records: [correctedRecord] }, [{ record: correctedRecord, revision: 2 }], 2)

    const artifact = readDocumentArtifact(fixture.root, fixture.branch)

    expect(artifact.kind).toBe('document')
    if (artifact.kind !== 'document') throw new Error('stale publication unavailable')
    expect(artifact.markdown).toBe(DOCUMENT_MANUSCRIPT)
    expect(artifact.stale).toBe(true)
  })

  it('rejects skill resource receipts that do not belong to the selected skill snapshot', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    const metadataPath = join(fixture.root, 'drafts', fixture.branch, 'evidence.json')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    metadata.skill.resourcesRead.push({ path: 'unselected.md', sha256: metadata.skill.entrySha256, complete: true })
    writeFileSync(metadataPath, JSON.stringify(metadata))

    expect(readDocumentArtifact(fixture.root, fixture.branch).kind).toBe('invalid')
  })

  it('rejects altered artifact source identity fields against the current preparation', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    const metadataPath = join(fixture.root, 'drafts', fixture.branch, 'evidence.json')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    metadata.source = {
      ...metadata.source, byteLength: 1, readRanges: [[0, 1]], revision: 100,
      markdownSha256: '0'.repeat(64), pdfSha256: '0'.repeat(64),
    }
    writeFileSync(metadataPath, JSON.stringify(metadata))

    expect(readDocumentArtifact(fixture.root, fixture.branch).kind).toBe('invalid')
  })

  it('continues to route shipped v1 publication metadata through the legacy reader', async () => {
    const fixture = documentFixture()
    const metadataPath = join(fixture.root, 'drafts', fixture.branch, 'evidence.json')
    writeFileSync(metadataPath, JSON.stringify({ version: 1 }))

    expect(readDocumentArtifact(fixture.root, fixture.branch).kind).toBe('legacy')
  })

  it('rejects duplicate repair resolutions instead of applying a finding twice', async () => {
    const fixture = await reviewedFixture()

    await expect(fixture.call('paper_task_apply_local_repair', {
      targets: [{ index: 1, markdown: 'Revised conclusion.' }],
      resolutions: [
        { finding_id: 'f1', resolved: true, explanation: 'Resolved.' },
        { finding_id: 'f1', resolved: false, explanation: 'Still unresolved.' },
      ],
    })).rejects.toThrow()

    expect(evaluateBranchQuality(fixture.root, fixture.branch).status).toBe('needs-confirmation')
  })

  it('rejects repair when the current source no longer matches the reviewed baseline', async () => {
    const fixture = await reviewedFixture()
    const correctedRecord = { ...fixture.record, text: 'Corrected evidence.' }
    fixture.store.replace('123e4567-e89b-12d3-a456-426614174000', fixture.root, { ...fixture.source, records: [correctedRecord] }, [{ record: correctedRecord, revision: 2 }], 2)

    await expect(fixture.call('paper_task_apply_local_repair', {
      targets: [{ index: 1, markdown: 'Revised conclusion.' }],
      resolutions: [{ finding_id: 'f1', resolved: true, explanation: 'Resolved.' }],
    })).rejects.toThrow()

    expect(evaluateBranchQuality(fixture.root, fixture.branch).status).toBe('needs-confirmation')
  })

  it('rejects repair when the review hash chain does not name the published baseline', async () => {
    const fixture = await reviewedFixture()
    const reviewPath = join(fixture.root, 'drafts', fixture.branch, 'review.json')
    const review = JSON.parse(readFileSync(reviewPath, 'utf8'))
    review.baselineSha256 = '0'.repeat(64)
    writeFileSync(reviewPath, JSON.stringify(review))

    await expect(fixture.call('paper_task_apply_local_repair', {
      targets: [{ index: 1, markdown: 'Revised conclusion.' }],
      resolutions: [{ finding_id: 'f1', resolved: true, explanation: 'Resolved.' }],
    })).rejects.toThrow('baseline or current source/skill identity changed')
  })
})
