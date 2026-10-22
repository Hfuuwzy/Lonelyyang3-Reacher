import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupDocumentFixtures, documentFixture, DOCUMENT_CRITERIA, DOCUMENT_MANUSCRIPT } from '../fixtures/paper-task-document'
import { readDocumentArtifact } from '../../server/paper-task/document-artifact.mjs'
import { evaluateBranchQuality } from '../../server/paper-task/branch-quality'

afterEach(cleanupDocumentFixtures)

const findings = [{ code: 'evidence', severity: 'substantive', description: '需要收窄结论的适用范围。', target_indexes: [1], source_pages: [1] }]

describe('skill-aligned manuscript review and local repair', () => {
  it.each(['translation', 'deep-reading'] as const)('repairs a reviewed %s paragraph without a claim-ledger ban or record-ID rereads', async (branch) => {
    const fixture = documentFixture({ branch })
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    await expect(fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '按技能要求审阅。', findings })).rejects.toThrow('read the complete saved manuscript')
    await fixture.call('paper_task_read_branch')
    await fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '已定位需收窄的结论。', findings })
    const replacement = '研究结果在原实验设置下有所改善，不能直接外推到全部场景。'

    await fixture.call('paper_task_apply_local_repair', { targets: [{ index: 1, markdown: replacement }], resolutions: [{ finding_id: 'f1', resolved: true, explanation: '已把结论限定在原实验设置。' }] })

    const document = readDocumentArtifact(fixture.root, branch)
    expect(document.kind).toBe('document')
    if (document.kind !== 'document') throw new Error('repaired document unavailable')
    expect(document.markdown).toBe(DOCUMENT_MANUSCRIPT.replace('研究结果有所改善，但这些证据并不能证明所有场景都适用。', replacement))
    expect(evaluateBranchQuality(fixture.root, branch)).toMatchObject({ status: 'preview', reviewCompleted: true })
    await expect(fixture.call('paper_task_apply_local_repair', { targets: [{ index: 1, markdown: replacement }], resolutions: [] })).rejects.toThrow('not available')
    await expect(fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '不允许第二次审阅。', findings: [] })).rejects.toThrow('already submitted')
  })

  it('consumes a rejected repair attempt but retains the original coherent manuscript and residual finding', async () => {
    const fixture = documentFixture()
    await fixture.prepare()
    await fixture.call('paper_task_write_branch', { markdown: DOCUMENT_MANUSCRIPT })
    await fixture.call('paper_task_read_branch')
    await fixture.call('paper_task_submit_content_review', { criteria: DOCUMENT_CRITERIA, assessment: '发现结论范围问题。', findings })

    await expect(fixture.call('paper_task_apply_local_repair', { targets: [{ index: 2, markdown: '不应改写这个段落。' }], resolutions: [] })).rejects.toThrow('reviewed manuscript paragraphs')

    const directory = join(fixture.root, 'drafts', fixture.branch)
    expect(readFileSync(join(directory, 'report.md'), 'utf8')).toBe(DOCUMENT_MANUSCRIPT)
    const review = JSON.parse(readFileSync(join(directory, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ attempted: true, error: 'repair-rejected', residualFindingIds: ['f1'] })
    expect(evaluateBranchQuality(fixture.root, fixture.branch).status).toBe('needs-confirmation')
    await expect(fixture.call('paper_task_apply_local_repair', { targets: [{ index: 1, markdown: '再次尝试。' }], resolutions: [] })).rejects.toThrow('not available')
  })
})
