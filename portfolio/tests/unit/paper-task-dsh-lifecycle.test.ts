/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createCanvas } from '@napi-rs/canvas'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings, replacePaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import type { PaperTaskSourceResult } from '../../app/utils/paper-task-source-contract'

const TASK_ID = '8a7cfce5-6a53-49c1-8a21-0ca8b6b2a991'
const MARKER = 'synthetic-provider-secret-marker'
const cropCanvas = createCanvas(2, 2)
const cropContext = cropCanvas.getContext('2d')
cropContext.fillStyle = '#d43f3a'
cropContext.fillRect(0, 0, 1, 2)
cropContext.fillStyle = '#2d8a62'
cropContext.fillRect(1, 0, 1, 2)
const PNG = cropCanvas.toBuffer('image/png')
const requestSchema = z.object({ stream: z.boolean().optional(), tools: z.array(z.unknown()).optional() }).passthrough()
const owned: { readonly service: PaperTaskService; readonly server: Server; readonly root: string }[] = []
const providerRequests: { readonly root: string; readonly requests: number[] }[] = []

afterEach(async () => {
  clearPaperTaskProviderSettings()
  providerRequests.splice(0)
  for (const fixture of owned.splice(0)) {
    await fixture.service.cancel(TASK_ID)
    fixture.server.closeAllConnections()
    await new Promise<void>((resolveClose, rejectClose) => {
      fixture.server.close((error) => error === undefined ? resolveClose() : rejectClose(error))
    })
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

describe('pinned DSH task terminal cleanup', () => {
  it('retains a safe diagnostic when selected branch resources are unavailable before runtime startup', async () => {
    const fixture = await setup('hold')
    const previousResourceRoot = process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT
    process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT = join(fixture.root, 'missing-deep-reading-skill')
    try {
      const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'deep-reading' })
      if (!submitted.ok) throw new Error('fixture task was not accepted')
      const events: PaperTaskEvent[] = []
      for await (const event of submitted.events) events.push(event)

      expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'failed', cleanup: 'clean', branches: { 'deep-reading': 'failed' } })
      const errorPath = join(fixture.root, 'project-local', TASK_ID, 'drafts', 'deep-reading', 'runtime-error.json')
      expect(existsSync(errorPath)).toBe(true)
      const runtimeError = JSON.parse(readFileSync(errorPath, 'utf8')) as Record<string, unknown>
      expect(runtimeError).toMatchObject({
        branch: 'deep-reading',
        stage: 'preflight',
        code: 'GENERATION_RESOURCES_UNAVAILABLE',
        message: 'The selected branch did not start because its local skill resources are unavailable or invalid. Check the local skill configuration and retry.',
      })
      expect(JSON.stringify(runtimeError)).not.toContain(MARKER)
      expect(providerRequests.find((entry) => entry.root === fixture.root)?.requests).toHaveLength(0)
    } finally {
      if (previousResourceRoot === undefined) delete process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT
      else process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT = previousResourceRoot
    }
  }, 45000)

  it('sanitizes provider failure and removes its real runtime while retaining the task', async () => {
    const fixture = await setup('failure')
    const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task was not accepted')
    const events: PaperTaskEvent[] = []
    for await (const event of submitted.events) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'failed', cleanup: 'clean', branches: { translation: 'failed', 'deep-reading': 'not-selected' } })
    expect(JSON.stringify(events)).not.toContain(MARKER)
    expect(existsSync(join(fixture.root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(fixture.root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
    const receipts = readFileSync(join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'image-input.json'), 'utf8')
    expect(receipts).toContain('"status":"blocked"')
    expect(receipts).toContain('"reason":"provider-failed"')
    const runtimeError = readFileSync(join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'runtime-error.json'), 'utf8')
    expect(runtimeError).not.toContain(MARKER)
    expect(runtimeError).toContain('"branch":"translation"')
    const diagnosticsPath = join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'runtime-diagnostics.json')
    const diagnostics = readFileSync(diagnosticsPath, 'utf8')
    expect(diagnostics).not.toContain(MARKER)
    expect(diagnostics).not.toContain('Bearer ' + MARKER)
    const receipt = JSON.parse(diagnostics) as {
      readonly runs: readonly { readonly endReasons: readonly { readonly kind: string; readonly code?: string; readonly message?: string }[] }[]
    }
    expect(receipt.runs[0]?.endReasons[0]?.kind).toBe('error')
    expect(receipt.runs[0]?.endReasons[0]?.code).toBeDefined()
    expect(receipt.runs[0]?.endReasons[0]?.message).toContain('400')
    expect(receipt.runs[0]?.endReasons[0]?.message).not.toContain(MARKER)
    expect(providerRequests.find((entry) => entry.root === fixture.root)?.requests).toHaveLength(1)
  }, 45000)

  it('retains the paired controlled write-tool rejection instead of reporting a missing file', async () => {
    const fixture = await setup('write-rejection')
    const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task was not accepted')
    const events: PaperTaskEvent[] = []
    for await (const event of submitted.events) events.push(event)
    const branchRoot = join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation')
    const runtimeError = readFileSync(join(branchRoot, 'runtime-error.json'), 'utf8')
    const diagnostics = JSON.parse(readFileSync(join(branchRoot, 'runtime-diagnostics.json'), 'utf8')) as {
      readonly runs: readonly { readonly failedTools: readonly { readonly tool: string; readonly code?: string }[] }[]
    }
    expect(runtimeError).toContain('paper_task_write_branch failed')
    expect(runtimeError).not.toContain('produced no master.md')
    expect(diagnostics.runs[0]?.failedTools[0]?.tool).toBe('paper_task_write_branch')
    expect(diagnostics.runs[0]?.failedTools[0]?.code).toBe('INVALID_ARGS')
    expect(providerRequests.find((entry) => entry.root === fixture.root)?.requests).toHaveLength(2)
  }, 45000)

  it('cancels an actual in-flight provider request and retains source materials', async () => {
    const fixture = await setup('hold')
    const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task was not accepted')
    const events: PaperTaskEvent[] = []
    const collecting = (async () => { for await (const event of submitted.events) events.push(event) })()
    await fixture.requestStarted
    expect(await fixture.service.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
    await collecting
    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'cancelled', cleanup: 'clean', branches: { translation: 'cancelled', 'deep-reading': 'not-selected' } })
    expect(existsSync(join(fixture.root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(fixture.root, 'project-local', TASK_ID, 'source-records', 'p1-r0.json'))).toBe(true)
    const receipts = readFileSync(join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'image-input.json'), 'utf8')
    expect(receipts).toContain('"status":"interrupted"')
    expect(receipts).toContain('"reason":"cancelled"')
  }, 45000)

  it('retains bounded primary diagnostics when cancellation interrupts after a source tool call', async () => {
    const fixture = await setup('hold-after-read')
    const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task was not accepted')
    const events: PaperTaskEvent[] = []
    const collecting = (async () => { for await (const event of submitted.events) events.push(event) })()

    await fixture.requestStarted
    expect(await fixture.service.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
    await collecting

    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'cancelled', cleanup: 'clean' })
    expect(existsSync(join(fixture.root, 'runtime-local', TASK_ID))).toBe(false)
    const diagnostics = JSON.parse(readFileSync(join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'runtime-diagnostics.json'), 'utf8')) as {
      readonly runs: readonly { readonly stage: string; readonly sessionId?: string; readonly toolCounts: Readonly<Record<string, number>>; readonly interrupted?: string; readonly runRejected?: boolean }[]
    }
    expect(diagnostics.runs[0]?.stage).toBe('primary')
    expect(diagnostics.runs[0]?.sessionId).toBeDefined()
    expect(diagnostics.runs[0]?.toolCounts.paper_task_read_input).toBe(1)
    expect(diagnostics.runs[0]?.interrupted).toBe('aborted')
    expect(diagnostics.runs[0]?.runRejected).toBeUndefined()
  }, 45000)

  it('reaps the real runtime when the consumer disconnects without deleting retained input', async () => {
    const fixture = await setup('hold')
    const submitted = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'translation' })
    if (!submitted.ok) throw new Error('fixture task was not accepted')
    const iterator = submitted.events[Symbol.asyncIterator]()
    await iterator.next()
    await fixture.requestStarted
    if (iterator.return === undefined) throw new Error('task stream does not support disconnect')
    await iterator.return()
    expect(existsSync(join(fixture.root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(fixture.root, 'project-local', TASK_ID, 'task-input.md'))).toBe(true)
    const receipts = readFileSync(join(fixture.root, 'project-local', TASK_ID, 'drafts', 'translation', 'image-input.json'), 'utf8')
    expect(receipts).toContain('"status":"interrupted"')
    expect(receipts).toContain('"reason":"cancelled"')
    expect(await fixture.service.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
  }, 45000)
})

async function setup(mode: 'failure' | 'hold' | 'hold-after-read' | 'write-rejection') {
  const requests: number[] = []
  let signalRequest = (): void => undefined
  const requestStarted = new Promise<void>((resolveRequest) => { signalRequest = resolveRequest })
  let writeAttempted = false
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if ((body.tools?.length ?? 0) > 0) requests.push(1)
      if (mode === 'failure') {
        response.writeHead(400, { 'content-type': 'application/json', connection: 'close' })
        response.end(JSON.stringify({ error: { message: `${MARKER} Authorization: Bearer ${MARKER} api_key=${MARKER}` } }))
      } else if (mode === 'write-rejection' && (body.tools?.length ?? 0) > 0 && !writeAttempted) {
        writeAttempted = true
        respondChoice(response, body.stream === true, { tool: 'paper_task_write_branch', arguments: {} })
      } else if (mode === 'write-rejection') {
        respondChoice(response, body.stream === true, { content: 'The write tool returned an error.' })
      } else if (mode === 'hold-after-read' && (body.tools?.length ?? 0) > 0 && requests.length === 1) {
        respondChoice(response, body.stream === true, { tool: 'paper_task_read_input', arguments: {} })
      } else if (mode === 'hold-after-read' && (body.tools?.length ?? 0) > 0) {
        signalRequest()
      } else if ((body.tools?.length ?? 0) > 0) {
        signalRequest()
      } else {
        respondTitle(response, body.stream === true)
      }
    })().catch(() => { response.writeHead(500); response.end() })
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture provider did not bind')
  const root = mkdtempSync(join(tmpdir(), 'paper-task-dsh-lifecycle-'))
  replacePaperTaskProviderSettings({ providerLabel: 'Local lifecycle fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: 'openai-completions', model: 'lifecycle-fixture', imageInput: true, apiKey: MARKER })
  const service = createPaperTaskService({
    projectRoot: root,
    createId: () => TASK_ID,
    prepareSource: async (): Promise<PaperTaskSourceResult> => ({
      success: true,
      source: { status: 'complete', pageCount: 1, records: [
        { id: 'p1-r0', order: 0, kind: 'body', text: 'Fixture source.', state: 'present', page: 1, bbox: [0, 0, 1, 1], sectionId: null, context: 'Fixture source.', links: [] },
        { id: 'p1-r1', order: 1, kind: 'table', text: 'Table 1. Lifecycle crop.', state: 'present', page: 1, bbox: [0, 0, 2, 2], sectionId: null, context: 'Results', links: [] },
      ] },
      assets: [{ recordId: 'p1-r1', page: 1, bbox: [0, 0, 2, 2], availability: 'available', understanding: 'unverified', mediaType: 'image/png', bytes: PNG }],
    }),
  })
  owned.push({ service, server, root })
  providerRequests.push({ root, requests })
  return { service, root, requestStarted }
}

function respondChoice(response: ServerResponse, stream: boolean, choice: { readonly tool: string; readonly arguments: object } | { readonly content: string }): void {
  const hasTool = 'tool' in choice
  const message = hasTool
    ? { role: 'assistant', tool_calls: [{ id: 'fixture-write-call', type: 'function', function: { name: choice.tool, arguments: JSON.stringify(choice.arguments) } }] }
    : { role: 'assistant', content: choice.content }
  if (!stream) {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    response.end(JSON.stringify({ id: 'write-fixture', model: 'lifecycle-fixture', choices: [{ index: 0, message, finish_reason: hasTool ? 'tool_calls' : 'stop' }] }))
    return
  }
  const delta = hasTool
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-write-call', type: 'function', function: { name: choice.tool, arguments: JSON.stringify(choice.arguments) } }] }
    : { role: 'assistant', content: choice.content }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
  response.end([
    `data: ${JSON.stringify({ id: 'write-fixture', object: 'chat.completion.chunk', model: 'lifecycle-fixture', choices: [{ index: 0, delta, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: 'write-fixture', object: 'chat.completion.chunk', model: 'lifecycle-fixture', choices: [{ index: 0, delta: {}, finish_reason: hasTool ? 'tool_calls' : 'stop' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'))
}

function respondTitle(response: ServerResponse, stream: boolean): void {
  if (!stream) {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    response.end(JSON.stringify({ id: 'title', model: 'lifecycle-fixture', choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture' }, finish_reason: 'stop' }] }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
  response.end([
    `data: ${JSON.stringify({ id: 'title', object: 'chat.completion.chunk', model: 'lifecycle-fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture' }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: 'title', object: 'chat.completion.chunk', model: 'lifecycle-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
    'data: [DONE]', '',
  ].join('\n\n'))
}
