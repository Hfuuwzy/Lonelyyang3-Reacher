import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupDocumentProtocols, collectDocumentTask, documentProtocol, PROTOCOL_TASK_ID } from '../fixtures/paper-task-document-protocol'

afterEach(cleanupDocumentProtocols)

describe('whole-original Markdown and interchangeable-skill DSH integration', () => {
  it.each([false, true])('runs a skill with optional custom nested workflow=%s without a framework whitelist', async (guide) => {
    const fixture = await documentProtocol({ guide })

    const events = await collectDocumentTask(fixture.service)

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', cleanup: 'clean' })
    const branch = join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading')
    const metadata = JSON.parse(readFileSync(join(branch, 'evidence.json'), 'utf8'))
    expect(metadata.skill.resourcesRead.map((resource: { readonly path: string }) => resource.path))
      .toEqual(guide ? ['SKILL.md', 'guides/workflow.md'] : ['SKILL.md'])
    const review = JSON.parse(readFileSync(join(branch, 'review.json'), 'utf8'))
    expect(review.version).toBe(2)
    expect(review.criteria[0].criterion).toBe(guide ? 'Connect assumptions to conclusions' : 'Explain source assumptions')
    expect(existsSync(join(fixture.root, 'runtime-local', PROTOCOL_TASK_ID))).toBe(false)
  }, 45000)

  it('accepts a content-changing v2 local repair through pinned DSH', async () => {
    const fixture = await documentProtocol({ repair: true })

    const events = await collectDocumentTask(fixture.service)

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', branches: { 'deep-reading': 'preview-ready' }, cleanup: 'clean' })
    expect(fixture.service.reader(PROTOCOL_TASK_ID)?.documents[0]?.markdown)
      .toContain('研究条件限制了结论。')
    const review = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading', 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ attempted: true, appliedFindingIds: ['f1'], changedTargets: [1] })
  }, 45000)

  it('delivers middle-of-document originals losslessly rather than pruning them or sending record JSON', async () => {
    const original = `${'Original contextual evidence. '.repeat(1400)} MIDDLE_ORIGINAL_SENTINEL ${'Later original evidence. '.repeat(1400)}`
    const fixture = await documentProtocol({ text: original })

    const events = await collectDocumentTask(fixture.service)

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', cleanup: 'clean' })
    const requests = JSON.stringify(fixture.received)
    expect(requests).toContain('MIDDLE_ORIGINAL_SENTINEL')
    expect(requests).not.toContain('tool result middle pruned')
    expect(requests).not.toContain('bbox')
    const metadata = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading', 'evidence.json'), 'utf8'))
    expect(metadata.source.readComplete).toBe(true)
    const diagnostics = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading', 'runtime-diagnostics.json'), 'utf8'))
    expect(diagnostics.runs[0].toolCounts.paper_task_read_source).toBe(1)
  }, 45000)
})
