import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings, replacePaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import type { PaperTaskEvent, PaperTaskSelection } from '../../app/utils/paper-task-contract'
import { preparedExtractionFixture } from './paper-task-source'
import { documentFrame, DOCUMENT_MANUSCRIPT } from './paper-task-document'
import { callsAndResults, closeServer, listenLoopback, respond, type Decision, type FixtureBody } from './paper-task-protocol'

export const PROTOCOL_TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const owned: { root: string; service: ReturnType<typeof createPaperTaskService>; server: ReturnType<typeof createServer> }[] = []
const saved = new Map<string, string | undefined>()
const envKeys = ['PAPER_TASK_TRANSLATION_SKILL_ROOT', 'PAPER_TASK_DEEP_READING_SKILL_ROOT'] as const

export async function cleanupDocumentProtocols() {
  clearPaperTaskProviderSettings()
  for (const fixture of owned.splice(0)) {
    await fixture.service.cancel(PROTOCOL_TASK_ID)
    await fixture.service.remove(PROTOCOL_TASK_ID)
    await closeServer(fixture.server)
    rmSync(fixture.root, { recursive: true, force: true })
  }
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
}

export async function documentProtocol(options: {
  readonly text?: string; readonly guide?: boolean; readonly translationGate?: Promise<void>;
  readonly choose?: (body: FixtureBody) => Decision; readonly sourceLimit?: number; readonly rejectFirstWrite?: boolean; readonly repair?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'paper-document-protocol-'))
  const skillRoot = join(root, 'skill')
  mkdirSync(skillRoot)
  writeFileSync(join(skillRoot, 'SKILL.md'), options.guide ? 'Read guides/workflow.md and apply its criterion.' : 'A self-contained custom skill: explain the source and review its assumptions.')
  if (options.guide) {
    mkdirSync(join(skillRoot, 'guides'))
    writeFileSync(join(skillRoot, 'guides', 'workflow.md'), 'Custom workflow A: connect assumptions to conclusions.')
  }
  for (const key of envKeys) {
    if (!saved.has(key)) saved.set(key, process.env[key])
    process.env[key] = skillRoot
  }
  const received: FixtureBody[] = []
  const server = createServer((request, response) => {
    void respond(request, response, { translationGate: options.translationGate ?? Promise.resolve(), choose: body => {
      if ((body.tools ?? []).length === 0) return { content: 'initialized' }
      received.push(body)
       return options.choose?.(body) ?? documentDecision(body, options)
    } }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error
      response.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"fixture protocol failed"}')
    })
  })
  let preparations = 0
  const text = options.text ?? 'The study reports an improvement, but the experimental conditions limit the conclusion.'
  const service = createPaperTaskService({ projectRoot: root, createId: () => PROTOCOL_TASK_ID, prepareSource: async () => {
    preparations++
    return preparedExtractionFixture({ success: true, pageCount: 1, pages: [{ readerPage: 1, text, lines: [{ text, isHeading: false }], headings: [] }] })
  } })
  owned.push({ root, service, server })
  replacePaperTaskProviderSettings({ providerLabel: 'Local document fixture', baseUrl: await listenLoopback(server), protocol: 'openai-completions', model: 'document-fixture', apiKey: '', imageInput: false })
  return { root, service, received, preparations: () => preparations }
}

export function documentDecision(body: FixtureBody, options: { readonly guide?: boolean; readonly sourceLimit?: number; readonly rejectFirstWrite?: boolean; readonly repair?: boolean } = {}): Decision {
  const calls = callsAndResults(body)
  const read = (name: string, path?: string): Decision | undefined => {
    const output = calls.filter(call => call.name === name && (path === undefined || call.arguments.path === path)).at(-1)?.output
    const page = output === undefined ? undefined : documentFrame(output)
    if (page === undefined || page.nextOffset < page.totalBytes) return { tool: name, arguments: { ...(path === undefined ? {} : { path }), offset: page?.nextOffset ?? 0, ...(name === 'paper_task_read_source' && options.sourceLimit !== undefined ? { limit_bytes: options.sourceLimit } : {}) } }
    return undefined
  }
  for (const [name, path] of [['paper_task_read_input', undefined], ['paper_task_read_resource', 'SKILL.md'], ...(options.guide ? [['paper_task_read_resource', 'guides/workflow.md']] : []), ['paper_task_read_source', undefined]] as const) {
    const decision = read(name, path)
    if (decision !== undefined) return decision
  }
  const writes = calls.filter(call => call.name === 'paper_task_write_branch')
  if (options.rejectFirstWrite && writes.length === 0) return { tool: 'paper_task_write_branch', arguments: { markdown: '' } }
  if (!writes.some(call => call.output?.includes('Manuscript saved.'))) return { tool: 'paper_task_write_branch', arguments: { markdown: DOCUMENT_MANUSCRIPT } }
  const manuscript = read('paper_task_read_branch')
  if (manuscript !== undefined) return manuscript
  const review = calls.find(call => call.name === 'paper_task_submit_content_review')
  if (review === undefined) return { tool: 'paper_task_submit_content_review', arguments: {
    criteria: [{ criterion: options.guide ? 'Connect assumptions to conclusions' : 'Explain source assumptions', verdict: 'satisfied', notes: 'The manuscript states its source-based conclusion and applicability.' }],
    assessment: 'Reviewed the manuscript against the selected skill.', findings: options.repair ? [{ code: 'omission', severity: 'substantive', description: 'Clarify the study limitation.', target_indexes: [1] }] : [],
  } }
  if (options.repair && !calls.some(call => call.name === 'paper_task_apply_local_repair')) return { tool: 'paper_task_apply_local_repair', arguments: {
    targets: [{ index: 1, markdown: '研究结果有所改善，但这些证据并不能证明所有场景都适用，研究条件限制了结论。' }],
    resolutions: [{ finding_id: 'f1', resolved: true, explanation: '明确指出研究条件对结论的限制。' }],
  } }
  return { content: '中文稿件及所选技能的内容审阅已保存。' }
}

export async function collectDocumentTask(service: ReturnType<typeof createPaperTaskService>, selection: PaperTaskSelection = 'deep-reading') {
  const submitted = await service.submit({ pdf: new Uint8Array(Buffer.from('%PDF-1.4\ncontrolled original')), selection })
  if (!submitted.ok) throw new Error('fixture submission failed')
  const events: PaperTaskEvent[] = []
  for await (const event of submitted.events) events.push(event)
  return events
}
