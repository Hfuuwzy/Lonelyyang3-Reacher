/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { apply } from '../../server/paper-task/controlled-tools.mjs'
import { createPaperTaskWorkspace } from '../../server/paper-task/workspace'
import { createPaperTaskSourceStore } from '../../server/paper-task/source-store'
import { snapshotGenerationResources } from '../../server/paper-task/generation-resources'
import { writeTaskInput } from '../../server/paper-task/input'
import type { PaperTaskBranch } from '../../app/utils/paper-task-contract'
import type { PaperTaskSource } from '../../app/utils/paper-task-source-contract'

export const DOCUMENT_MANUSCRIPT = '# 自选分析结构\n\n研究结果有所改善，但这些证据并不能证明所有场景都适用。\n\n应当在新的样本上检验结论。'
export const DOCUMENT_TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
export const DOCUMENT_CRITERIA = [{ criterion: '解释原文结论并交代其适用范围', verdict: 'satisfied', notes: '正文区分研究结果与进一步外推。' }]
const keys = ['PAPER_TASK_WORKSPACE', 'PAPER_TASK_BRANCH_ROOT', 'PAPER_TASK_RESOURCE_ROOT', 'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH'] as const
const saved = new Map<string, string | undefined>()
const roots: string[] = []

export function cleanupDocumentFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
}

export function documentFixture(options: { readonly branch?: PaperTaskBranch; readonly text?: string; readonly status?: PaperTaskSource['status']; readonly skillFiles?: Readonly<Record<string, string>> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'paper-document-tools-'))
  roots.push(root)
  const branch = options.branch ?? 'deep-reading'
  createPaperTaskWorkspace(root, new Uint8Array(Buffer.from('%PDF-1.4\noriginal fixture')))
  const record = { id: 'p1-r0', order: 0, kind: 'body' as const, text: options.text ?? 'The study reports an improvement. Its applicability is limited.', state: 'present' as const, page: 1, bbox: [0, 0, 1, 1] as const, sectionId: null, context: '', links: [] }
  const source: PaperTaskSource = { status: options.status ?? 'complete', pageCount: 1, records: [record] }
  const store = createPaperTaskSourceStore()
  store.save(DOCUMENT_TASK_ID, root, source, [])
  const skillRoot = join(root, 'selected-skill')
  mkdirSync(skillRoot)
  for (const [path, text] of Object.entries(options.skillFiles ?? { 'SKILL.md': '# A self-contained skill\nExplain the source in natural prose and review applicability.' })) {
    mkdirSync(join(skillRoot, path, '..'), { recursive: true })
    writeFileSync(join(skillRoot, path), text)
  }
  snapshotGenerationResources(root, [branch], { [branch]: skillRoot })
  writeTaskInput(root, DOCUMENT_TASK_ID, branch)
  const env = { PAPER_TASK_WORKSPACE: root, PAPER_TASK_BRANCH_ROOT: join(root, 'drafts', branch), PAPER_TASK_RESOURCE_ROOT: join(root, 'generation-resources'), PAPER_TASK_INPUT: join(root, 'task-input.md'), PAPER_TASK_BRANCH: branch }
  for (const key of keys) {
    if (!saved.has(key)) saved.set(key, process.env[key])
    process.env[key] = env[key]
  }
  const registered = new Map<string, { readonly execute: (args: unknown, context: object) => Promise<unknown> }>()
  apply({ tools: { register(tool: { readonly name: string; readonly execute: (args: unknown, context: object) => Promise<unknown> }) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }, effect() {} })
  const call = async (name: string, args: object = {}): Promise<string> => {
    const tool = registered.get(name)
    if (tool === undefined) throw new Error('fixture tool missing')
    const value = await tool.execute(args, {})
    if (typeof value !== 'string') throw new Error('fixture tool returned non-text')
    return value
  }
  const prepare = async (): Promise<void> => {
    await readDocumentPages(offset => call('paper_task_read_resource', { path: 'SKILL.md', offset }))
    await readDocumentPages(offset => call('paper_task_read_source', { offset }))
  }
  return { root, branch, record, source, store, call, prepare, names: [...registered.keys()], markdown: () => readFileSync(join(root, 'source.md'), 'utf8') }
}

const frameSchema = z.object({ file: z.string(), offset: z.number(), nextOffset: z.number(), totalBytes: z.number(), sha256: z.string() }).passthrough()
export function documentFrame(value: string) {
  const boundary = value.indexOf('\n\n')
  if (boundary < 0) throw new Error('document frame header missing')
  return { ...frameSchema.parse(JSON.parse(value.slice(0, boundary))), text: value.slice(boundary + 2) }
}

export async function readDocumentPages(read: (offset: number) => Promise<string>): Promise<string> {
  let offset = 0, text = '', total = 0
  do {
    const page = documentFrame(await read(offset))
    text += page.text
    offset = page.nextOffset
    total = page.totalBytes
  } while (offset < total)
  return text
}
