/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../server/paper-task/controlled-tools.mjs'

const roots: string[] = []
const savedEnvironment = new Map<string, string | undefined>()
const environmentKeys = [
  'PAPER_TASK_WORKSPACE', 'PAPER_TASK_SOURCE_ROOT', 'PAPER_TASK_RESOURCE_ROOT',
  'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH_ROOT', 'PAPER_TASK_BRANCH',
] as const

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnvironment.clear()
})

describe('translation review and local repair protocol', () => {
  it('allows one review and one targeted repair, and rejects every further write or review', async () => {
    const fixture = setupTranslation()
    await prepareTranslation(fixture)

    await expect(fixture.tools.paper_task_write_branch({ segments: translationSegments() }))
      .rejects.toThrow('already published')
    await expect(fixture.tools.paper_task_submit_content_review({ findings: [] }))
      .rejects.toThrow('read the complete published preview')

    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'number', severity: 'substantive', description: '数值表述需要核对。', target_indexes: [0], record_ids: ['p1-r0'] },
    ] })
    await expect(fixture.tools.paper_task_submit_content_review({ findings: [] }))
      .rejects.toThrow('already submitted')

    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
    await expect(fixture.tools.paper_task_read_source({ record_id: 'p1-r2' }))
      .rejects.toThrow('repair may only re-read cited source context')
    await fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 0, markdown: '# 未完成译文\n\nAlpha 主体报告数值 42。' }] })
    await expect(fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 1, markdown: '不允许。' }] }))
      .rejects.toThrow('already attempted')

    const after = readFileSync(join(fixture.branchRoot, 'master.md'), 'utf8')
    expect(after).toContain('Beta 主体报告数值7。')
    expect(after).toContain('## 附录 A 补充细节\n\n附加说明。')
    expect(after).not.toContain('Alpha 主体报告数值42。')
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({
      attempted: true, appliedFindingIds: ['f1'], residualFindingIds: [], changedTargets: [0],
    })
  })

  it('keeps a partially repaired finding residual and never loops', async () => {
    const fixture = setupTranslation()
    await prepareTranslation(fixture)
    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'number', severity: 'substantive', description: '第一处需要核对。', target_indexes: [0], record_ids: ['p1-r0'] },
      { code: 'number', severity: 'substantive', description: '第二处需要核对。', target_indexes: [1], record_ids: ['p1-r1'] },
    ] })
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r1', offset }))
    await fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 0, markdown: '# 未完成译文\n\nAlpha 主体报告数值 42。' }] })
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ appliedFindingIds: ['f1'], residualFindingIds: ['f2'] })
  })

  it('consumes the single repair attempt when cited records were not re-read', async () => {
    const fixture = setupTranslation()
    await prepareTranslation(fixture)
    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'number', severity: 'substantive', description: '数值表述需要核对。', target_indexes: [0], record_ids: ['p1-r0'] },
    ] })
    await expect(fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 0, markdown: '# 未完成译文\n\nAlpha 主体报告数值 42。' }] }))
      .rejects.toThrow('read each cited source record again')
    await expect(fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 0, markdown: '# 未完成译文\n\nAlpha 主体报告数值 42。' }] }))
      .rejects.toThrow('already attempted')
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ attempted: true, appliedFindingIds: [], residualFindingIds: ['f1'] })
  })

  it('rejects a target that no substantive finding named', async () => {
    const fixture = setupTranslation()
    await prepareTranslation(fixture)
    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'number', severity: 'substantive', description: '第一处需要核对。', target_indexes: [0], record_ids: ['p1-r0'] },
    ] })
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
    await expect(fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 1, markdown: '不允许。' }] }))
      .rejects.toThrow('not named by a substantive review finding')
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ attempted: true, appliedFindingIds: [], residualFindingIds: ['f1'], error: 'repair-rejected' })
  })
})

describe('deep-reading review and local repair protocol', () => {
  it('repairs a non-evidence paragraph without changing the claim paragraphs or separators', async () => {
    const fixture = setupDeepReading()
    await prepareDeepReading(fixture)
    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'layout', severity: 'substantive', description: '标题需要修正。', target_indexes: [0] },
    ] })
    await fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 0, markdown: '# 报告（修订）' }] })
    const originalRest = fixture.report.slice(fixture.report.indexOf('事实：'))
    expect(readFileSync(join(fixture.branchRoot, 'report.md'), 'utf8')).toBe(`# 报告（修订）\n\n${originalRest}`)
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ appliedFindingIds: ['f1'], residualFindingIds: [], changedTargets: [0] })
  })

  it('refuses to rewrite a paragraph that carries claim evidence', async () => {
    const fixture = setupDeepReading()
    await prepareDeepReading(fixture)
    await readAll((offset) => fixture.tools.paper_task_read_branch({ offset }))
    await fixture.tools.paper_task_submit_content_review({ findings: [
      { code: 'number', severity: 'substantive', description: '事实段落需要核对。', target_indexes: [1], record_ids: ['p1-r0'] },
    ] })
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
    await expect(fixture.tools.paper_task_apply_local_repair({ targets: [{ index: 1, markdown: '事实：改写后的段落。' }] }))
      .rejects.toThrow('claim evidence')
    const review = JSON.parse(readFileSync(join(fixture.branchRoot, 'review.json'), 'utf8'))
    expect(review.repair).toMatchObject({ attempted: true, appliedFindingIds: [], residualFindingIds: ['f1'], error: 'repair-rejected' })
    expect(readFileSync(join(fixture.branchRoot, 'report.md'), 'utf8')).toBe(fixture.report)
  })
})

function setupTranslation() {
  const root = makeRoot('translation')
  const sourceRoot = join(root, 'source-records')
  writeFileSync(join(sourceRoot, 'p1-r0.json'), JSON.stringify(stored('p1-r0', 'body', 'Alpha subject reported value 42.', 0)))
  writeFileSync(join(sourceRoot, 'p1-r1.json'), JSON.stringify(stored('p1-r1', 'body', 'Beta subject reported value 7.', 1)))
  writeFileSync(join(sourceRoot, 'p1-r2.json'), JSON.stringify(stored('p1-r2', 'appendix', 'Appendix A. Extra detail.', 2)))
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(['p1-r0', 'p1-r1', 'p1-r2']))
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete', revision: 1, assets: [] }))
  writeSkill(root, 'translation')
  return createTools(root, 'translation')
}

function setupDeepReading() {
  const root = makeRoot('deep-reading')
  const sourceRoot = join(root, 'source-records')
  const text = 'The sample improved scores by eight percentage points.'
  writeFileSync(join(sourceRoot, 'p1-r0.json'), JSON.stringify(stored('p1-r0', 'body', text, 0)))
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(['p1-r0']))
  writeFileSync(join(root, 'source-state.json'), JSON.stringify({ status: 'complete', revision: 1, assets: [] }))
  writeSkill(root, 'deep-reading')
  writeSkill(root, 'deep-reading', 'references/critical_thinking.md')
  const report = '# 报告\n\n事实：第一学年干预组平均测验分数提高八个百分点。\n\n分析推论：该结果可能适用于相似样本。'
  const fixture = createTools(root, 'deep-reading')
  return { ...fixture, report, sourceText: text }
}

async function prepareTranslation(fixture: ReturnType<typeof setupTranslation>): Promise<void> {
  await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md', offset }))
  await fixture.tools.paper_task_list_sources({ offset: 0, limit: 100 })
  for (const id of ['p1-r0', 'p1-r1', 'p1-r2']) {
    await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: id, offset }))
  }
  await fixture.tools.paper_task_write_branch({ segments: translationSegments() })
}

async function prepareDeepReading(fixture: ReturnType<typeof setupDeepReading>): Promise<void> {
  await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md', offset }))
  await readAll((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:references:critical_thinking.md', offset }))
  await fixture.tools.paper_task_list_sources({ offset: 0, limit: 100 })
  await readAll((offset) => fixture.tools.paper_task_read_source({ record_id: 'p1-r0', offset }))
  await fixture.tools.paper_task_write_branch({
    markdown: fixture.report,
    source_record_ids: ['p1-r0'],
    claim_evidence: [
      { passage: '事实：第一学年干预组平均测验分数提高八个百分点。', kind: 'fact', source_record_id: 'p1-r0', quote: fixture.sourceText },
      { passage: '分析推论：该结果可能适用于相似样本。', kind: 'inference', source_record_id: 'p1-r0', quote: fixture.sourceText, explanation: '这是对结果的解释。' },
    ],
  })
}

function translationSegments() {
  return [
    { markdown: '# 未完成译文\n\nAlpha 主体报告数值42。', source_record_ids: ['p1-r0'] },
    { markdown: 'Beta 主体报告数值7。', source_record_ids: ['p1-r1'] },
    { markdown: '## 附录 A 补充细节\n\n附加说明。', source_record_ids: ['p1-r2'] },
  ]
}

function createTools(root: string, branch: 'translation' | 'deep-reading') {
  const sourceRoot = join(root, 'source-records')
  const resourceRoot = join(root, 'generation-resources')
  const branchRoot = join(root, 'drafts', branch)
  const env = {
    PAPER_TASK_WORKSPACE: root,
    PAPER_TASK_SOURCE_ROOT: sourceRoot,
    PAPER_TASK_RESOURCE_ROOT: resourceRoot,
    PAPER_TASK_INPUT: join(root, 'task-input.md'),
    PAPER_TASK_BRANCH_ROOT: branchRoot,
    PAPER_TASK_BRANCH: branch,
  }
  writeFileSync(env.PAPER_TASK_INPUT, '# Task')
  for (const [key, value] of Object.entries(env)) {
    if (!savedEnvironment.has(key)) savedEnvironment.set(key, process.env[key])
    process.env[key] = value
  }
  const registered = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>()
  apply({
    tools: {
      register(tool: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }) {
        registered.set(tool.name, tool)
        return () => { registered.delete(tool.name) }
      },
      restrict() { return () => undefined },
    },
    effect() {},
  })
  const invoke = async (name: string, args: object): Promise<string> => {
    const result = await registered.get(name)?.execute(args, {})
    if (typeof result !== 'string') throw new Error(`tool ${name} did not return text`)
    return result
  }
  return {
    root, branchRoot,
    tools: {
      paper_task_read_resource: (args: { resource_id: string; offset?: number }) => invoke('paper_task_read_resource', args),
      paper_task_list_sources: (args: { offset: number; limit: number }) => invoke('paper_task_list_sources', args),
      paper_task_read_source: (args: { record_id: string; offset?: number }) => invoke('paper_task_read_source', args),
      paper_task_read_branch: (args: { offset?: number }) => invoke('paper_task_read_branch', args),
      paper_task_write_branch: (args: object) => invoke('paper_task_write_branch', args),
      paper_task_submit_content_review: (args: object) => invoke('paper_task_submit_content_review', args),
      paper_task_apply_local_repair: (args: object) => invoke('paper_task_apply_local_repair', args),
    },
  }
}

function makeRoot(branch: 'translation' | 'deep-reading'): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-review-protocol-'))
  roots.push(root)
  mkdirSync(join(root, 'source-records'))
  mkdirSync(join(root, 'generation-resources'))
  mkdirSync(join(root, 'drafts', branch, 'pieces'), { recursive: true })
  return root
}

function writeSkill(root: string, branch: 'translation' | 'deep-reading', relativePath = 'SKILL.md'): void {
  const resourceRoot = join(root, 'generation-resources')
  const id = `${branch}:${relativePath.replaceAll('/', ':')}`
  const contents = relativePath === 'SKILL.md'
    ? `---\nname: ${branch === 'translation' ? 'academic-paper-zh-translation' : 'deep-reading-analyst'}\nversion: 1.1.0\n---\nPinned ${branch} skill.`
    : `Pinned ${branch} reference.`
  const bytes = Buffer.from(contents)
  writeFileSync(join(resourceRoot, id.replaceAll(':', '--')), bytes)
  const indexPath = join(resourceRoot, 'index.json')
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8')) as object[]
    } catch {
      return []
    }
  })()
  existing.push({ id, relativePath, sha256: createHash('sha256').update(bytes).digest('hex') })
  writeFileSync(indexPath, JSON.stringify(existing))
}

function stored(id: string, kind: string, text: string, order: number) {
  return {
    record: { id, kind, text, state: 'present', order, page: 1, bbox: [0, 0, 1, 1], sectionId: null, context: '', links: [] },
    revision: 1,
  }
}

async function readAll(read: (offset: number) => Promise<string>): Promise<string> {
  let offset = 0
  let text = ''
  let total = 0
  do {
    const page = JSON.parse(await read(offset))
    text += page.text
    total = page.totalBytes
    offset = page.nextOffset
  } while (offset < total)
  return text
}
