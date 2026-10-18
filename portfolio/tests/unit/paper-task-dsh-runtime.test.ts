/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createCanvas } from '@napi-rs/canvas'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings, replacePaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import { preparedExtractionFixture } from '../fixtures/paper-task-source'
import type { PaperExtractionResult } from '../../server/utils/paper-review/pdf'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'

const TASK_ID = '7e1f1b50-40ac-49f6-a4fb-7bf92945a22d'
const EXPECTED_TOOLS = [
  'paper_task_read_input',
  'paper_task_list_sources',
  'paper_task_read_source',
  'paper_task_list_resources',
  'paper_task_read_resource',
  'paper_task_read_branch',
  'paper_task_write_branch',
  'paper_task_submit_content_review',
  'paper_task_apply_local_repair',
]
const cropCanvas = createCanvas(3, 2)
const cropContext = cropCanvas.getContext('2d')
cropContext.fillStyle = '#d43f3a'
cropContext.fillRect(0, 0, 2, 2)
cropContext.fillStyle = '#2d8a62'
cropContext.fillRect(2, 0, 1, 2)
const PNG = cropCanvas.toBuffer('image/png')
const SKILL_ID = 'translation:SKILL.md'
const RESOURCE_PAGE_BYTES = 4000
const PLAN = [
  { tool: 'paper_task_read_input', arguments: {} },
  { tool: 'paper_task_list_sources', arguments: {} },
  { tool: 'paper_task_read_source', arguments: { record_id: 'p1-r0' } },
  { tool: 'paper_task_read_source', arguments: { record_id: 'p1-r1' } },
  { tool: 'paper_task_list_resources', arguments: {} },
  { tool: 'paper_task_read_resource', arguments: { resource_id: SKILL_ID, offset: 0, limit_bytes: RESOURCE_PAGE_BYTES } },
] as const

type AgentDecision = { readonly tool: string; readonly arguments: unknown } | { readonly content: string }

const roots: string[] = []
const servers: Server[] = []
const services: PaperTaskService[] = []

const requestSchema = z.object({
  model: z.string(),
  stream: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.unknown(),
    tool_calls: z.array(z.object({
      id: z.string().optional(),
      function: z.object({ name: z.string(), arguments: z.string() }).optional(),
    }).passthrough()).optional(),
    tool_call_id: z.string().optional(),
  }).passthrough()).optional(),
  tools: z.array(z.object({ function: z.object({ name: z.string() }).passthrough() }).passthrough()).optional(),
}).passthrough()

type FixtureBody = z.infer<typeof requestSchema>

afterEach(async () => {
  clearPaperTaskProviderSettings()
  for (const service of services.splice(0)) {
    await service.cancel(TASK_ID)
    await service.remove(TASK_ID)
  }
  for (const server of servers.splice(0)) await closeServer(server)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paper-task DSH integration', () => {
  it('runs the pinned DSH SDK and CLI against a keyless local protocol fixture with only controlled tools', async () => {
    const received: FixtureBody[] = []
    const agent = createFixtureAgent()
    const server = createServer((request, response) => {
      void respond(request, response, (body) => {
        received.push(body)
        return (body.tools ?? []).length === 0
          ? { content: 'ok' }
          : agent.decide(body)
      })
    })
    servers.push(server)
    const baseUrl = await listenLoopback(server)
    const root = mkdtempSync(join(tmpdir(), 'paper-task-dsh-fixture-'))
    roots.push(root)
    const extraction: PaperExtractionResult = {
      success: true,
      pageCount: 1,
      pages: [{ readerPage: 1, lines: [{ text: 'Fixture source sentence.', isHeading: false }], headings: [], text: 'Fixture source sentence.' }],
    }
    const prepareSource = async (): Promise<PaperTaskSourceResult> => {
      const prepared = preparedExtractionFixture(extraction)
      if (!prepared.success) return prepared
      return {
        success: true,
        source: {
          status: 'complete', pageCount: 1,
          records: [
            { id: 'p1-r0', order: 0, kind: 'body', text: 'Fixture source sentence.', state: 'present', page: 1, bbox: [0, 0, 1, 1], sectionId: null, context: 'Fixture source sentence.', links: [] },
            { id: 'p1-r1', order: 1, kind: 'table', text: 'Table 1. Original outcomes.', state: 'present', page: 1, bbox: [12, 20, 240, 120], sectionId: null, context: 'Results section', links: [] },
          ],
        },
        assets: [{ recordId: 'p1-r1', page: 1, bbox: [12, 20, 240, 120], availability: 'available', understanding: 'unverified', mediaType: 'image/png', bytes: PNG }],
      }
    }
    replacePaperTaskProviderSettings({
      providerLabel: 'Local protocol fixture',
      baseUrl,
      protocol: 'openai-completions',
      model: 'paper-task-fixture',
      imageInput: true,
      apiKey: '',
    })
    const service = createPaperTaskService({ projectRoot: root, prepareSource, createId: () => TASK_ID })
    services.push(service)
    const submission = await service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    expect(submission.ok).toBe(true)
    if (!submission.ok) throw new Error('paper task submission failed')

    const events = await collect(submission.events)
    const agentRequests = received.filter((body) => (body.tools ?? []).length > 0)
    expect(agentRequests.length).toBeGreaterThan(0)
    const imageRequest = agentRequests.find((body) => body.messages?.some((message) => Array.isArray(message.content)
      && message.content.some((block) => block !== null && typeof block === 'object' && 'type' in block && block.type === 'image_url')))
    expect(imageRequest).toBeDefined()
    const imageMessage = imageRequest?.messages?.find((message) => Array.isArray(message.content)
      && message.content.some((block) => block !== null && typeof block === 'object' && 'type' in block && block.type === 'image_url'))
    const contentBlocks = Array.isArray(imageMessage?.content) ? imageMessage.content : []
    const imageIndex = contentBlocks.findIndex((block) => block !== null && typeof block === 'object' && 'type' in block && block.type === 'image_url')
    const imageBlock = contentBlocks[imageIndex]
    expect(imageBlock).toMatchObject({ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } })
    const requestText = contentBlocks.map((block) => block !== null && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '').join('\n')
    expect(requestText).toContain('"taskId":"' + TASK_ID + '"')
    expect(requestText).toContain('"branch":"translation"')
    expect(requestText).toContain('"recordId":"p1-r1"')
    expect(requestText).toContain('"revision":1')
    const firstRequest = agentRequests[0]
    if (firstRequest?.tools === undefined) throw new Error('fixture did not receive tool definitions')
    const firstTools = firstRequest.tools.map((tool) => tool.function.name).sort()
    expect(firstTools).toEqual([...EXPECTED_TOOLS].sort())
    const pages = agentRequests.map((body) => lastPage(body, 'paper_task_read_resource', SKILL_ID)).filter((page): page is ResourcePage => page !== undefined)
    expect(pages.length).toBeGreaterThan(1)
    expect(new Set(pages.map((page) => page.offset)).size).toBeGreaterThan(1)
    const last = pages.at(-1)
    if (last === undefined) throw new Error('fixture did not receive a resource page')
    expect(last.nextOffset).toBe(last.totalBytes)
    expect(pages.some((page) => page.text.includes('name: academic-paper-zh-translation'))).toBe(true)

    const terminal = events.at(-1)
    expect(terminal).toMatchObject({ type: 'terminal', outcome: 'succeeded', branches: { translation: 'complete', 'deep-reading': 'not-selected' }, cleanup: 'clean' })
    const preview = events.find((event) => event.type === 'preview')
    expect(preview).toMatchObject({ type: 'preview', designation: 'generated-preview', quality: { status: 'complete', issues: [] } })
    if (preview?.type !== 'preview') throw new Error('fixture did not emit a preview event')
    expect(preview.paragraphs[0]).toBe('# 未完成译文')
    expect(preview.paragraphs[1]).toBe('Fixture source sentence.')
    expect(preview.paragraphs[2]).toBe('Table 1: original outcomes.')
    expect(preview.paragraphs[3]).toMatch(/^!\[Table 1: original outcomes\.\]\(asset:asset-[0-9a-f]+\)$/u)
    const master = readFileSync(join(root, 'project-local', TASK_ID, 'drafts', 'translation', 'master.md'), 'utf8')
    expect(master).toBe(preview.paragraphs.join('\n\n'))
    expect(JSON.parse(readFileSync(join(root, 'project-local', TASK_ID, 'drafts', 'translation', 'translation.json'), 'utf8'))).toMatchObject({ status: 'complete', segments: [{ index: 0 }, { index: 1 }] })
    expect(existsSync(join(root, 'project-local', TASK_ID, 'assets'))).toBe(true)
    expect(existsSync(join(root, 'runtime-local', TASK_ID, 'translation', 'attachments-home'))).toBe(false)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
    expect(readFileSync(join(root, 'project-local', TASK_ID, 'drafts', 'translation', 'image-input.json'), 'utf8')).toContain('"status":"transported"')
    expect(await service.remove(TASK_ID)).toEqual({ ok: true, code: 'deleted' })
  }, 45000)
})

function createFixtureAgent(): { readonly decide: (body: FixtureBody) => AgentDecision } {
  let step = 0
  return {
    decide(body: FixtureBody): AgentDecision {
      if (step < PLAN.length) {
        const next = PLAN[step++]
        if (next === undefined) throw new Error('fixture agent plan is unavailable')
        return { tool: next.tool, arguments: next.arguments }
      }
      if (step === PLAN.length) {
        const page = lastPage(body, 'paper_task_read_resource', SKILL_ID)
        if (page !== undefined && page.nextOffset < page.totalBytes) {
          return { tool: 'paper_task_read_resource', arguments: { resource_id: SKILL_ID, offset: page.nextOffset, limit_bytes: RESOURCE_PAGE_BYTES } }
        }
        step++
        const assetId = listedAssetId(body, 'p1-r1')
        if (assetId === undefined) throw new Error('fixture did not receive a table asset')
        return {
          tool: 'paper_task_write_branch',
          arguments: { segments: [
            { markdown: '# 未完成译文\n\nFixture source sentence.', source_record_ids: ['p1-r0'] },
            { markdown: `Table 1: original outcomes.\n\n![Table 1: original outcomes.](asset:${assetId})`, source_record_ids: ['p1-r1'] },
          ] },
        }
      }
      const branchPage = lastPage(body, 'paper_task_read_branch')
      if (branchPage === undefined) return { tool: 'paper_task_read_branch', arguments: { offset: 0 } }
      if (branchPage.nextOffset < branchPage.totalBytes) {
        return { tool: 'paper_task_read_branch', arguments: { offset: branchPage.nextOffset } }
      }
      if (!toolWasCalled(body, 'paper_task_submit_content_review')) {
        return { tool: 'paper_task_submit_content_review', arguments: { findings: [] } }
      }
      return { content: 'The retained branch preview is ready.' }
    },
  }
}

function lastPage(body: FixtureBody, toolName: string, resourceId?: string): ResourcePage | undefined {
  const calls = new Map<string, { readonly name: string; readonly arguments: string }>()
  let page: ResourcePage | undefined
  for (const message of body.messages ?? []) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (call.id === undefined || call.function === undefined) continue
        calls.set(call.id, { name: call.function.name, arguments: call.function.arguments })
      }
    }
    if (message.role !== 'tool' || message.tool_call_id === undefined) continue
    const call = calls.get(message.tool_call_id)
    if (call === undefined || call.name !== toolName) continue
    if (resourceId !== undefined) {
      let named: unknown
      try {
        const parsedArguments = z.object({ resource_id: z.string() }).passthrough().safeParse(JSON.parse(call.arguments))
        named = parsedArguments.success ? parsedArguments.data.resource_id : undefined
      } catch {
        named = undefined
      }
      if (named !== resourceId) continue
    }
    const text = contentText(message.content)
    if (text.length === 0) continue
    try {
      const parsed = z.object({ offset: z.number(), nextOffset: z.number(), totalBytes: z.number(), text: z.string() }).safeParse(JSON.parse(text))
      if (parsed.success) page = parsed.data
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return page
}

function toolWasCalled(body: FixtureBody, toolName: string): boolean {
  return (body.messages ?? []).some((message) => message.role === 'assistant'
    && (message.tool_calls ?? []).some((call) => call.function?.name === toolName))
}

type ResourcePage = {
  readonly offset: number
  readonly nextOffset: number
  readonly totalBytes: number
  readonly text: string
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const blocks: readonly unknown[] = content
    return blocks.map((block) => (block !== null && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '')).join('')
  }
  return ''
}

function listedAssetId(body: FixtureBody, recordId: string): string | undefined {
  const calls = new Map<string, string>()
  for (const message of body.messages ?? []) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        if (call.id !== undefined && call.function !== undefined) calls.set(call.id, call.function.name)
      }
    }
    if (message.role !== 'tool' || message.tool_call_id === undefined || calls.get(message.tool_call_id) !== 'paper_task_list_sources') continue
    try {
      const parsed = z.object({
        assets: z.array(z.object({ id: z.string(), recordId: z.string(), availability: z.string() }).passthrough()),
      }).passthrough().safeParse(JSON.parse(contentText(message.content)))
      if (!parsed.success) continue
      const asset = parsed.data.assets.find((candidate) => candidate.recordId === recordId && candidate.availability === 'available')
      if (asset !== undefined) return asset.id
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return undefined
}

function isAgentDecisionTool(decision: AgentDecision): decision is Extract<AgentDecision, { readonly tool: string }> {
  return 'tool' in decision
}

async function collect(events: AsyncIterable<PaperTaskEvent>): Promise<readonly PaperTaskEvent[]> {
  const collected: PaperTaskEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function respond(
  request: IncomingMessage,
  response: import('node:http').ServerResponse,
  choose: (body: FixtureBody) => AgentDecision,
): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const decision = choose(body)
  const responseBody = isAgentDecisionTool(decision)
    ? { role: 'assistant', tool_calls: [{ id: `fixture-call-${Date.now()}`, type: 'function', function: { name: decision.tool, arguments: JSON.stringify(decision.arguments) } }] }
    : { role: 'assistant', content: decision.content }
  const finishReason = isAgentDecisionTool(decision) ? 'tool_calls' : 'stop'
  const id = `fixture-response-${Date.now()}`
  if (body.stream === true) {
    const delta = isAgentDecisionTool(decision)
      ? { role: 'assistant', tool_calls: [{ index: 0, id: `fixture-call-${Date.now()}`, type: 'function', function: { name: decision.tool, arguments: JSON.stringify(decision.arguments) } }] }
      : { role: 'assistant', content: decision.content }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
    response.end([
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'))
    return
  }
  response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  response.end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: responseBody, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
}

async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('local protocol fixture did not bind a TCP port')
  return `http://127.0.0.1:${address.port}/v1`
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error))
  })
}
