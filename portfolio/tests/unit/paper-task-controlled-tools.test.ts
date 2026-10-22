/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupDocumentFixtures, documentFixture, documentFrame, DOCUMENT_CRITERIA, DOCUMENT_MANUSCRIPT, DOCUMENT_TASK_ID, readDocumentPages } from '../fixtures/paper-task-document'
import { evaluateBranchQuality } from '../../server/paper-task/branch-quality'
import { readPaperTaskTranslation } from '../../server/paper-task/translation-access'
import { readDocumentArtifact } from '../../server/paper-task/document-artifact.mjs'

afterEach(cleanupDocumentFixtures)

describe('selected-skill Markdown task tools', () => {
  it.each(['translation', 'deep-reading'] as const)('publishes %s as whole Markdown without source IDs, segments or lexical labels', async (branch) => {
    const fixture = documentFixture({ branch })
    await fixture.prepare()

    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    await readDocumentPages(offset => fixture.call('paper_task_read_branch', { offset }))
    await fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '已按照所选技能核对结论与适用边界。', findings: [] })

    const artifact = readDocumentArtifact(fixture.root, branch)
    expect(artifact.kind).toBe('document')
    if (artifact.kind !== 'document') throw new Error('publication unavailable')
    expect(artifact.markdown).toBe(DOCUMENT_MANUSCRIPT)
    expect(artifact.metadata.provenance).toBe('document-only')
    expect(artifact.metadata.source.readComplete).toBe(true)
    expect(artifact.metadata).not.toHaveProperty('segments')
    expect(artifact.metadata).not.toHaveProperty('claims')
    expect(evaluateBranchQuality(fixture.root, branch)).toMatchObject({ status: 'preview', reviewCompleted: true })
    if (branch === 'translation') expect(readPaperTaskTranslation(DOCUMENT_TASK_ID, fixture.root)?.markdown).toBe(DOCUMENT_MANUSCRIPT)
    expect(fixture.names).not.toContain('paper_task_list_sources')
    expect(fixture.names).toContain('paper_task_search_source')
  })

  it('returns an ordinary complete source as raw Markdown in one call rather than record JSON', async () => {
    const fixture = documentFixture()
    const frame = documentFrame(await fixture.call('paper_task_read_source'))
    expect(frame.text).toBe(fixture.markdown())
    expect(frame.nextOffset).toBe(frame.totalBytes)
    expect(frame.text).not.toContain('p1-r0')
    expect(frame.text).not.toContain('bbox')
  })

  it('supports long lossless UTF-8 reads and refuses publication before actual full delivery', async () => {
    const fixture = documentFixture({ text: 'Original 中文😀 evidence. '.repeat(12000) })
    await fixture.call('paper_task_read_resource', { path: 'SKILL.md' })
    await fixture.call('paper_task_read_source', { limit_bytes: 4 })
    await expect(fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })).rejects.toThrow('complete source.md')
    const text = await readDocumentPages(offset => fixture.call('paper_task_read_source', { offset, limit_bytes: 12000 }))
    expect(text).toBe(fixture.markdown())
    expect(text).not.toContain('\uFFFD')
    await expect(fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })).resolves.toContain('saved')
  })

  it('loads a nested workflow selected by its own skill without requiring any predefined framework', async () => {
    const fixture = documentFixture({ skillFiles: { 'SKILL.md': 'Read guides/workflow.md', 'guides/workflow.md': 'Read ../check.md', 'check.md': 'Use the source-specific criterion.' } })
    expect(documentFrame(await fixture.call('paper_task_read_resource', { path: '../check.md', from: 'guides/workflow.md' })).text).toBe('Use the source-specific criterion.')
    await expect(fixture.call('paper_task_read_resource', { path: '../../outside.md' })).rejects.toThrow('escapes')
    await expect(fixture.call('paper_task_read_resource', { path: 'references/critical_thinking.md' })).rejects.toThrow('not part')
  })

  it('requires the selected entry and rejects changed source or foreign assets', async () => {
    const fixture = documentFixture()
    await fixture.call('paper_task_read_source')
    await expect(fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })).rejects.toThrow('selected SKILL.md')
    await fixture.call('paper_task_read_resource', { path: 'SKILL.md' })
    await expect(fixture.call('paper_task_write_branch', { markdown: `${DOCUMENT_MANUSCRIPT}\n\n![foreign](asset:foreign)` })).rejects.toThrow('foreign')
    writeFileSync(join(fixture.root, 'source.md'), 'tampered')
    await expect(fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })).rejects.toThrow('preparation receipt')
  })

  it('keeps actual source limitations honest without a wall of per-record issues', async () => {
    const fixture = documentFixture({ status: 'needs-confirmation' })
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT, limitations: ['所选技能要求的外部检索工具不可用。'] })
    await fixture.call('paper_task_read_branch')
    await fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '保留明确的能力限制。', findings: [] })
    const quality = evaluateBranchQuality(fixture.root, fixture.branch)
    expect(quality.status).toBe('needs-confirmation')
    expect(quality.issues.map(issue => issue.code)).toEqual(['source-unverified', 'declared-limitation'])
    expect(readFileSync(join(fixture.root, 'drafts', fixture.branch, 'report.md'), 'utf8')).toBe(DOCUMENT_MANUSCRIPT)
  })
})
