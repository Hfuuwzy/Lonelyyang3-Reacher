/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../server/paper-task/controlled-tools.mjs'

const roots: string[] = []
const savedEnvironment = new Map()
const environmentKeys = [
  'PAPER_TASK_WORKSPACE', 'PAPER_TASK_SOURCE_ROOT', 'PAPER_TASK_RESOURCE_ROOT',
  'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH_ROOT', 'PAPER_TASK_BRANCH',
]

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnvironment.clear()
})

describe('paper task controlled tools', () => {
  it('rejects undersized UTF-8 pages and advances at the minimum supported size', async () => {
    const fixture = setup({ skill: '中😀文' })
    for (const limit_bytes of [1, 2, 3]) {
      await expect(fixture.tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md', limit_bytes }))
        .rejects.toThrow('page limits are invalid')
    }
    let offset = 0
    let text = ''
    while (offset < Buffer.byteLength(fixture.skill)) {
      const page = JSON.parse(await fixture.tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md', offset, limit_bytes: 4 }))
      expect(page.nextOffset).toBeGreaterThan(offset)
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(4)
      text += page.text
      offset = page.nextOffset
    }
    expect(text).toBe('中😀文')
  })
  it('rejects an oversized resource before returning any page', async () => {
    const fixture = setup({ skill: 'x'.repeat(200001) })
    await expect(fixture.tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md' }))
      .rejects.toThrow('paper task file exceeds its read limit')
  })
  it('reads full multibyte skill and source content through bounded pages before saving a preview', async () => {
    const fixture = setup({ skill: `---\nname: academic-paper-zh-translation\nversion: 1.1.0\n---\n${'学'.repeat(5000)}`, source: { text: '证'.repeat(5000) } })
    const tools = fixture.tools
    const skillText = await readAllPages((offset) => tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md', offset, limit_bytes: 12000 }))
    const sourceText = await readAllPages((offset) => tools.paper_task_read_source({ record_id: 'p1-r0', offset, limit_bytes: 12000 }))
    expect(skillText).toBe(fixture.skill)
    expect(sourceText).toBe(fixture.sourceText)
    const saved = await tools.paper_task_write_branch({ markdown: '# Unfinished preview', source_record_ids: ['p1-r0'] })
    expect(saved).toBe('Branch preview saved.')
    expect(readFileSync(join(fixture.branchRoot, 'preview.md'), 'utf8')).toBe('# Unfinished preview')
    expect(JSON.parse(readFileSync(join(fixture.branchRoot, 'pieces', 'translation-p1-r0.json'), 'utf8'))).toEqual({
      id: 'translation-p1-r0', dependencies: [{ recordId: 'p1-r0', revision: 3 }], stale: false,
    })
  })

  it('rejects an unindexed dependency before publishing any branch output', async () => {
    const fixture = setup()
    await readAllPages((offset) => fixture.tools.paper_task_read_resource({ resource_id: 'translation:SKILL.md', offset, limit_bytes: 12000 }))
    await fixture.tools.paper_task_read_source({ record_id: 'p1-r0' })
    await expect(fixture.tools.paper_task_write_branch({ markdown: '# Invalid', source_record_ids: ['p99-r1'] }))
      .rejects.toThrow('source dependency list is invalid')
    expect(() => readFileSync(join(fixture.branchRoot, 'preview.md'))).toThrow()
    expect(() => readFileSync(join(fixture.branchRoot, 'pieces', 'translation-p1-r0.json'))).toThrow()
  })

  it('pages the complete source index and rejects oversized page requests', async () => {
    const fixture = setup()
    writeFileSync(join(fixture.taskRoot, 'source-index.json'), JSON.stringify(['p1-r0', 'p1-r1', 'p1-r2']))
    const first = JSON.parse(await fixture.tools.paper_task_list_sources({ offset: 0, limit: 2 }))
    const second = JSON.parse(await fixture.tools.paper_task_list_sources({ offset: first.nextOffset, limit: 2 }))
    expect(first).toEqual({ offset: 0, nextOffset: 2, totalItems: 3, items: ['p1-r0', 'p1-r1'] })
    expect(second).toEqual({ offset: 2, nextOffset: 3, totalItems: 3, items: ['p1-r2'] })
    await expect(fixture.tools.paper_task_list_sources({ offset: 0, limit: 101 })).rejects.toThrow('source page limits are invalid')
  })

  it.each([
    { activeBranch: 'translation', siblingBranch: 'deep-reading' },
    { activeBranch: 'deep-reading', siblingBranch: 'translation' },
  ] as const)('loads only $activeBranch resources from the shared branch index', async ({ activeBranch, siblingBranch }) => {
    const fixture = setup({ branch: activeBranch })
    const siblingId = `${siblingBranch}:SKILL.md`
    const siblingBytes = Buffer.from(`Pinned ${siblingBranch} skill.`)
    writeFileSync(join(fixture.taskRoot, 'generation-resources', siblingId.replaceAll(':', '--')), siblingBytes)
    const indexPath = join(fixture.taskRoot, 'generation-resources', 'index.json')
    const entries = JSON.parse(readFileSync(indexPath, 'utf8'))
    entries.push({
      id: siblingId,
      relativePath: 'SKILL.md',
      sha256: createHash('sha256').update(siblingBytes).digest('hex'),
    })
    writeFileSync(indexPath, JSON.stringify(entries))

    const activeResources = JSON.parse(await fixture.tools.paper_task_list_resources())
    expect(activeResources).toEqual([{
      id: fixture.resourceId,
      relativePath: 'SKILL.md',
      sha256: createHash('sha256').update(fixture.skill).digest('hex'),
    }])
    const activeSkill = JSON.parse(await fixture.tools.paper_task_read_resource({ resource_id: fixture.resourceId }))
    expect(activeSkill.text).toBe(fixture.skill)
    await expect(fixture.tools.paper_task_read_resource({ resource_id: siblingId }))
      .rejects.toThrow('unsupported resource identifier')
  })

  it('denies resource IDs from another branch and blocks writes before the full skill is read', async () => {
    const fixture = setup()
    await expect(fixture.tools.paper_task_read_resource({ resource_id: 'deep-reading:SKILL.md' }))
      .rejects.toThrow('unsupported resource identifier')
    await expect(fixture.tools.paper_task_write_branch({ markdown: '# Too early', source_record_ids: [] }))
      .rejects.toThrow('read the complete pinned branch skill')
    await expect(fixture.tools.paper_task_read_source({ record_id: 'p1-r0/../../outside' }))
      .rejects.toThrow('unsupported source record identifier')
    expect(() => readFileSync(join(fixture.branchRoot, 'preview.md'))).toThrow()
  })
})

function setup(options: { readonly branch?: 'translation' | 'deep-reading'; readonly skill?: string; readonly source?: { readonly text: string } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-tools-'))
  roots.push(root)
  const branch = options.branch ?? 'translation'
  const taskRoot = root
  const sourceRoot = join(root, 'source-records')
  const resourceRoot = join(root, 'generation-resources')
  const branchRoot = join(root, 'drafts', branch)
  const piecesRoot = join(branchRoot, 'pieces')
  mkdirSync(sourceRoot)
  mkdirSync(resourceRoot)
  mkdirSync(piecesRoot, { recursive: true })
  const skill = options.skill ?? '---\nname: academic-paper-zh-translation\nversion: 1.1.0\n---\nPinned skill.'
  const resourceBytes = Buffer.from(skill)
  const source = options.source ?? { text: 'Original text.' }
  const storedSource = { record: { id: 'p1-r0', text: source.text }, revision: 3 }
  const sourceText = JSON.stringify(storedSource)
  const resourceId = `${branch}:SKILL.md`
  writeFileSync(join(root, 'task-input.md'), '# Instructions')
  writeFileSync(join(root, 'source-index.json'), JSON.stringify(['p1-r0']))
  writeFileSync(join(sourceRoot, 'p1-r0.json'), sourceText)
  writeFileSync(join(resourceRoot, resourceId.replaceAll(':', '--')), resourceBytes)
  writeFileSync(join(resourceRoot, 'index.json'), JSON.stringify([{
    id: resourceId,
    relativePath: 'SKILL.md',
    sha256: createHash('sha256').update(resourceBytes).digest('hex'),
  }]))
  const env = {
    PAPER_TASK_WORKSPACE: taskRoot,
    PAPER_TASK_SOURCE_ROOT: sourceRoot,
    PAPER_TASK_RESOURCE_ROOT: resourceRoot,
    PAPER_TASK_INPUT: join(root, 'task-input.md'),
    PAPER_TASK_BRANCH_ROOT: branchRoot,
    PAPER_TASK_BRANCH: branch,
  }
  for (const [key, value] of Object.entries(env)) {
    if (!savedEnvironment.has(key)) savedEnvironment.set(key, process.env[key])
    process.env[key] = value
  }
  const registered = new Map<string, { readonly name: string; execute(args: unknown, exec: unknown): Promise<unknown> }>()
  const toolsContext = {
    tools: {
      register(tool: { readonly name: string; execute(args: unknown, exec: unknown): Promise<unknown> }) {
        registered.set(tool.name, tool)
        return () => { registered.delete(tool.name) }
      },
      restrict() { return () => undefined },
    },
    effect(_dispose: () => void) {},
  }
  apply(toolsContext)
  const invoke = async (toolName: string, args: object): Promise<string> => {
    const tool = registered.get(toolName)
    if (tool === undefined) throw new Error(`tool ${toolName} was not registered`)
    const result = await tool.execute(args, {})
    if (typeof result !== 'string') throw new Error('controlled tool returned a non-text result')
    return result
  }
  const tools = {
    paper_task_read_resource: (args: { readonly resource_id: string; readonly offset?: number; readonly limit_bytes?: number }) => invoke('paper_task_read_resource', args),
    paper_task_read_source: (args: { readonly record_id: string; readonly offset?: number; readonly limit_bytes?: number }) => invoke('paper_task_read_source', args),
    paper_task_list_resources: () => invoke('paper_task_list_resources', {}),
    paper_task_list_sources: (args: { readonly offset?: number; readonly limit?: number }) => invoke('paper_task_list_sources', args),
    paper_task_write_branch: (args: { readonly markdown: string; readonly source_record_ids: readonly string[] }) => invoke('paper_task_write_branch', args),
  }
  return { taskRoot, branchRoot, resourceId, skill, sourceText, tools }
}

async function readAllPages(readPage: (offset: number) => Promise<string>): Promise<string> {
  let offset = 0
  let text = ''
  let totalBytes = 0
  do {
    const page = JSON.parse(await readPage(offset))
    expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(12000)
    expect(page.offset).toBe(offset)
    text += page.text
    offset = page.nextOffset
    totalBytes = page.totalBytes
  } while (offset < totalBytes)
  return text
}
