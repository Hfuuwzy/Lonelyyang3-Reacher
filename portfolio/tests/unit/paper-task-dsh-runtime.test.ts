import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { callsAndResults } from '../fixtures/paper-task-protocol'
import { cleanupDocumentProtocols, collectDocumentTask, documentProtocol, PROTOCOL_TASK_ID } from '../fixtures/paper-task-document-protocol'
import { DOCUMENT_MANUSCRIPT } from '../fixtures/paper-task-document'

afterEach(cleanupDocumentProtocols)

describe('pinned DSH selected-skill Markdown protocol', () => {
  it('publishes both whole manuscripts with one preparation and accepts a corrected rejected write', async () => {
    const fixture = await documentProtocol({ rejectFirstWrite: true })

    const events = await collectDocumentTask(fixture.service, 'both')

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', branches: { translation: 'preview-ready', 'deep-reading': 'preview-ready' }, cleanup: 'clean' })
    expect(fixture.preparations()).toBe(1)
    const view = fixture.service.reader(PROTOCOL_TASK_ID)
    expect(view?.documents.map(document => document.markdown)).toEqual([DOCUMENT_MANUSCRIPT, DOCUMENT_MANUSCRIPT])
    const translation = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'translation', 'translation.json'), 'utf8'))
    const reading = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading', 'evidence.json'), 'utf8'))
    expect(translation.source.fingerprint).toBe(reading.source.fingerprint)
    expect(translation.version).toBe(2)
    expect(translation).not.toHaveProperty('segments')
    const names = fixture.received[0]?.tools?.map(tool => tool.function.name) ?? []
    expect(names).toEqual(expect.arrayContaining(['paper_task_search_source', 'paper_task_read_resource', 'paper_task_write_branch']))
    expect(names).not.toContain('paper_task_list_sources')
    expect(JSON.stringify(fixture.received[0]?.tools)).not.toContain('source_record_ids')
    expect(JSON.stringify(fixture.received[0]?.tools)).not.toContain('claim_evidence')
  }, 45000)

  it('accepts repaired v2 receipts for both branches through pinned DSH', async () => {
    const fixture = await documentProtocol({ repair: true })

    const events = await collectDocumentTask(fixture.service, 'both')

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', branches: { translation: 'preview-ready', 'deep-reading': 'preview-ready' }, cleanup: 'clean' })
    const view = fixture.service.reader(PROTOCOL_TASK_ID)
    expect(view?.documents.map(document => document.markdown)).toEqual([
      '# 自选分析结构\n\n研究结果有所改善，但这些证据并不能证明所有场景都适用，研究条件限制了结论。\n\n应当在新的样本上检验结论。',
      '# 自选分析结构\n\n研究结果有所改善，但这些证据并不能证明所有场景都适用，研究条件限制了结论。\n\n应当在新的样本上检验结论。',
    ])
    for (const branch of ['translation', 'deep-reading'] as const) {
      const review = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', branch, 'review.json'), 'utf8'))
      expect(review.repair).toMatchObject({ attempted: true, appliedFindingIds: ['f1'], changedTargets: [1] })
    }
  }, 45000)

  it('uses exactly one same-session continuation without losing the original Markdown history', async () => {
    const fixture = await documentProtocol({ choose: body => {
      const calls = callsAndResults(body)
      if (!calls.some(call => call.name === 'paper_task_read_input')) return { tool: 'paper_task_read_input', arguments: {} }
      if (!calls.some(call => call.name === 'paper_task_read_source')) return { tool: 'paper_task_read_source', arguments: {} }
      return { content: 'Original-reading history is retained, but this fixture does not publish.' }
    } })

    const events = await collectDocumentTask(fixture.service)

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'failed', cleanup: 'clean' })
    const diagnostics = JSON.parse(readFileSync(join(fixture.root, 'project-local', PROTOCOL_TASK_ID, 'drafts', 'deep-reading', 'runtime-diagnostics.json'), 'utf8'))
    expect(diagnostics.runs).toHaveLength(2)
    expect(diagnostics.runs[0].sessionId).toBe(diagnostics.runs[1].sessionId)
    expect(JSON.stringify(fixture.received.at(-1)?.messages)).toContain('The study reports an improvement')
    expect(JSON.stringify(fixture.received.at(-1)?.messages)).toContain('Original-reading history is retained')
  }, 45000)
})
