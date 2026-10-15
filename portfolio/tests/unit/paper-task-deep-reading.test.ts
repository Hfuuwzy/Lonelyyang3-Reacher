/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { apply } from '../../server/paper-task/controlled-tools.mjs'

const roots: string[] = []
const sourcePageSchema = z.object({ items: z.array(z.string()) })
const envKeys = ['PAPER_TASK_WORKSPACE', 'PAPER_TASK_SOURCE_ROOT', 'PAPER_TASK_RESOURCE_ROOT', 'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH_ROOT', 'PAPER_TASK_BRANCH'] as const
const savedEnv = new Map<string, string | undefined>()

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const key of envKeys) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
})

describe('deep-reading whole-paper evidence boundary', () => {
  it('requires complete index discovery and all records, including more than 200 indexed records', async () => {
    const fixture = setup(205)
    await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md', offset }))
    await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:references:critical_thinking.md', offset }))
    for (let offset = 0; offset < 205; offset += 100) {
      const page = sourcePageSchema.parse(JSON.parse(await fixture.tools.paper_task_list_sources({ offset, limit: 100 })))
      for (const recordId of page.items) await readAll((byteOffset) => fixture.tools.paper_task_read_source({ record_id: recordId, offset: byteOffset }))
    }
    const claims = Array.from({ length: 205 }, (_, index) => ({
      passage: `Fact: record ${index} establishes the stated result.`, kind: 'fact',
      source_record_id: `p1-r${index}`, quote: `Evidence ${index}.`,
    }))
    const inference = { passage: 'Inference: the result may generalize to similar samples.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is interpretation beyond the author-reported text.' }
    await expect(fixture.tools.paper_task_write_branch({ markdown: [...claims.map((claim) => claim.passage), inference.passage].join('\n\n'), source_record_ids: claims.map((claim) => claim.source_record_id), claim_evidence: [...claims, inference] })).resolves.toContain('saved')
    expect(readFileSync(join(fixture.branchRoot, 'report.md'), 'utf8')).toContain('Fact: record 204 establishes')
    expect(JSON.parse(readFileSync(join(fixture.branchRoot, 'evidence.json'), 'utf8')).claims).toHaveLength(206)
  })

  it('rejects incomplete index or source records before saving a report', async () => {
    const fixture = setup(2)
    await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md', offset }))
    await fixture.tools.paper_task_list_sources({ offset: 0, limit: 1 })
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
    const markdown = 'Fact: the source states the result. Inference: this supports the result.'
    const claim = [{ passage: 'Fact: the source states the result.', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' }, { passage: 'Inference: this supports the result.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'Interpretation from the reported statement.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claim })).rejects.toThrow('complete index discovery')
    expect(() => readFileSync(join(fixture.branchRoot, 'report.md'))).toThrow()
  })

  it('rejects a partially read indexed record even after discovering the full index', async () => {
    const fixture = setup(1)
    await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md', offset }))
    await fixture.tools.paper_task_list_sources({ offset: 0, limit: 100 })
    await fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset: 0, limit_bytes: 4 })
    const markdown = 'Fact: the source states a result. Inference: this supports an interpretation.'
    const claims = [{ passage: 'Fact: the source states a result.', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' }, { passage: 'Inference: this supports an interpretation.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is an interpretation.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('every indexed source record')
  })

  it('rejects evidence that names an unknown source record', async () => {
    const fixture = setup(1)
    await ready(fixture)
    const markdown = 'Fact: a result was reported. Inference: it could generalize.'
    const claims = [{ passage: 'Fact: a result was reported.', kind: 'fact', source_record_id: 'p9-r9', quote: 'fabricated' }, { passage: 'Inference: it could generalize.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is an interpretation.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('unknown source record')
  })

  it('rejects visual-only records as verified evidence even when textual content matches', async () => {
    const fixture = setup(1, [{ id: 'asset-abc', recordId: 'p1-r0', availability: 'available', understanding: 'unverified', relativePath: '../../assets/asset-abc.png' }], 'table')
    await ready(fixture)
    const markdown = 'Fact: the figure confirms a trend. Inference: this indicates growth.'
    const claims = [{ passage: 'Fact: the figure confirms a trend.', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' }, { passage: 'Inference: this indicates growth.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This interprets the alleged trend.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('visual-only')
  })

  it('rejects fabricated evidence quotes', async () => {
    const fixture = setup(1)
    await ready(fixture)
    const passage = 'Fact: the source reports a result. Inference: this might generalize.'
    const claims = [{ passage: 'Fact: the source reports a result.', kind: 'fact', source_record_id: 'p1-r0', quote: 'invented quote' }, { passage: 'Inference: this might generalize.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is an inference.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown: passage, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('quote does not match')
  })

  it('rejects a source revision changed after its evidence was read', async () => {
    const fixture = setup(1)
    await ready(fixture)
    writeFileSync(join(fixture.sourceRoot, 'p1-r0.json'), JSON.stringify({ record: { id: 'p1-r0', text: 'Evidence 0.', order: 0, kind: 'body', state: 'present' }, revision: 4 }))
    const markdown = 'Fact: the source reports a result. Inference: this might generalize.'
    const claims = [{ passage: 'Fact: the source reports a result.', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' }, { passage: 'Inference: this might generalize.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is interpretation beyond the report.' }]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('changed after it was read')
  })

  it('retains a truthful confirmation note for unread assets', async () => {
    const fixture = setup(1, [{ id: 'asset-abc', recordId: 'p1-r0', availability: 'available', understanding: 'unverified', relativePath: '../../assets/asset-abc.png' }])
    await ready(fixture)
    const markdown = 'Fact: the text reports a result. Inference: this is consistent with the hypothesis.\n\nConfirmation needed: the associated figure has not been verified.'
    const claim = [{ passage: 'Fact: the text reports a result.', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' }, { passage: 'Inference: this is consistent with the hypothesis.', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is interpretation, not an explicit author conclusion.' }]
    await fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claim, uncompleted_reasons: ['asset-abc remains unverified'] })
    expect(readFileSync(join(fixture.branchRoot, 'preview.md'), 'utf8')).toBe(markdown)
    expect(JSON.parse(readFileSync(join(fixture.branchRoot, 'evidence.json'), 'utf8'))).toMatchObject({
      status: 'needs-confirmation', assets: [{ relativePath: '../../assets/asset-abc.png', understanding: 'unverified' }],
    })
  })

  it('rejects an unverified asset when the reader report silently omits confirmation', async () => {
    const fixture = setup(1, [{ id: 'asset-abc', recordId: 'p1-r0', availability: 'available', understanding: 'unverified', relativePath: '../../assets/asset-abc.png' }])
    await ready(fixture)
    const markdown = '事实：论文报告该结果。\n\n分析推论：结果可能推广。'
    const claims = [
      { passage: '事实：论文报告该结果。', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' },
      { passage: '分析推论：结果可能推广。', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This goes beyond the text.' },
    ]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims, uncompleted_reasons: ['The crop is unverified.'] })).rejects.toThrow('disclose unverified source material')
  })

  it('accepts a naturally phrased Chinese report with claim-matched fact and inference cues', async () => {
    const fixture = setup(1)
    await ready(fixture)
    const markdown = '论文陈述：研究观察到该结果。\n\n分析推论：这一结果可能适用于相似样本。'
    const claims = [
      { passage: '论文陈述：研究观察到该结果。', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' },
      { passage: '分析推论：这一结果可能适用于相似样本。', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: '这是对报告结果的解释，并非作者明示结论。' },
    ]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).resolves.toContain('saved')
  })

  it('rejects fact classification when the cited report passage is marked as an inference', async () => {
    const fixture = setup(1)
    await ready(fixture)
    const markdown = '事实：论文报告了该结果。\n\n推论：这一结果或许可以推广。'
    const claims = [
      { passage: '推论：这一结果或许可以推广。', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' },
      { passage: '事实：论文报告了该结果。', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'This is misclassified.' },
    ]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('passage classification')
  })

  it('rejects gap records as verified evidence even if state says present', async () => {
    const fixture = setup(1, [], 'gap')
    await ready(fixture)
    const markdown = '事实：原文报告结果。推论：该结果可能适用。'
    const claims = [
      { passage: '事实：原文报告结果。', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' },
      { passage: '推论：该结果可能适用。', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'Interpretation.' },
    ]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('gap record')
  })

  it('rejects a source index changed after complete discovery', async () => {
    const fixture = setup(1)
    await ready(fixture)
    writeFileSync(join(fixture.root, 'source-index.json'), JSON.stringify(['p1-r0', 'p1-r1']))
    const markdown = '事实：原文报告结果。推论：该结果可能适用。'
    const claims = [
      { passage: '事实：原文报告结果。', kind: 'fact', source_record_id: 'p1-r0', quote: 'Evidence 0.' },
      { passage: '推论：该结果可能适用。', kind: 'inference', source_record_id: 'p1-r0', quote: 'Evidence 0.', explanation: 'Interpretation.' },
    ]
    await expect(fixture.tools.paper_task_write_branch({ markdown, source_record_ids: ['p1-r0'], claim_evidence: claims })).rejects.toThrow('index discovery')
  })

  it('denies source-state symlinks that resolve outside the task workspace', async () => {
    const fixture = setup(1)
    const outsidePath = join(fixture.root, '..', 'outside-paper-state.json')
    roots.push(outsidePath)
    writeFileSync(outsidePath, JSON.stringify({ status: 'complete', assets: [] }))
    rmSync(join(fixture.root, 'source-state.json'))
    symlinkSync(outsidePath, join(fixture.root, 'source-state.json'))
    await expect(fixture.tools.paper_task_list_sources({ offset: 0, limit: 1 })).rejects.toThrow('outside the assigned directory')
  })
})

async function ready(fixture: ReturnType<typeof setup>): Promise<void> {
  await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md', offset }))
  await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:references:critical_thinking.md', offset }))
  await fixture.tools.paper_task_list_sources({ offset: 0, limit: 100 })
  await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
}

async function readAll(read: (offset: number) => Promise<string>): Promise<string> {
  let offset = 0
  let result = ''
  let total = 0
  do {
    const page = JSON.parse(await read(offset))
    result += page.text
    total = page.totalBytes
    offset = page.nextOffset
  } while (offset < total)
  return result
}

function setup(count: number, assets: readonly object[] = [], kind = 'body') {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-deep-reading-'))
  roots.push(root)
  const sourceRoot = join(root, 'source-records')
  const resourceRoot = join(root, 'generation-resources')
  const branchRoot = join(root, 'drafts', 'deep-reading')
  mkdirSync(sourceRoot)
  mkdirSync(resourceRoot)
  mkdirSync(join(branchRoot, 'pieces'), { recursive: true })
  const ids = Array.from({ length: count }, (_, index) => `p1-r${index}`)
  for (const [index, id] of ids.entries()) writeFileSync(join(sourceRoot, `${id}.json`), JSON.stringify({ record: { id, text: `Evidence ${index}.`, order: index, kind, state: 'present' }, revision: 3 }))
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(ids))
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete', assets }))
  const skill = 'Pinned deep reading skill.'
  const skillBytes = Buffer.from(skill)
  const skillId = 'deep-reading:SKILL.md'
  const frameworkId = 'deep-reading:references:critical_thinking.md'
  const frameworkBytes = Buffer.from('Pinned critical thinking framework.')
  writeFileSync(join(resourceRoot, skillId.replaceAll(':', '--')), skillBytes)
  writeFileSync(join(resourceRoot, frameworkId.replaceAll(':', '--')), frameworkBytes)
  writeFileSync(join(resourceRoot, 'index.json'), JSON.stringify([
    { id: skillId, relativePath: 'SKILL.md', sha256: createHash('sha256').update(skillBytes).digest('hex') },
    { id: frameworkId, relativePath: 'references/critical_thinking.md', sha256: createHash('sha256').update(frameworkBytes).digest('hex') },
  ]))
  const env = { PAPER_TASK_WORKSPACE: root, PAPER_TASK_SOURCE_ROOT: sourceRoot, PAPER_TASK_RESOURCE_ROOT: resourceRoot, PAPER_TASK_INPUT: join(root, 'task-input.md'), PAPER_TASK_BRANCH_ROOT: branchRoot, PAPER_TASK_BRANCH: 'deep-reading' }
  writeFileSync(env.PAPER_TASK_INPUT, '# Task')
  for (const [key, value] of Object.entries(env)) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
    process.env[key] = value
  }
  const registered = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>()
  apply({ tools: { register(tool: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }) { registered.set(tool.name, tool); return () => registered.delete(tool.name) }, restrict() { return () => undefined } }, effect() {} })
  const invoke = async (name: string, args: object): Promise<string> => {
    const result = await registered.get(name)?.execute(args, {})
    if (typeof result !== 'string') throw new Error('tool result was not text')
    return result
  }
  return {
    root,
    branchRoot,
    sourceRoot,
    tools: {
      paper_task_read_resource: (args: { resource_id: string; offset?: number }) => invoke('paper_task_read_resource', args),
      paper_task_list_sources: (args: { offset: number; limit: number }) => invoke('paper_task_list_sources', args),
      paper_task_read_source: (args: { record_id: string; offset?: number; limit_bytes?: number }) => invoke('paper_task_read_source', args),
      paper_task_write_branch: (args: { markdown: string; source_record_ids: string[]; claim_evidence: object[]; uncompleted_reasons?: string[] }) => invoke('paper_task_write_branch', args),
    },
  }
}
