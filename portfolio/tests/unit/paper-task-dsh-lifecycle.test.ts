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

afterEach(async () => {
  clearPaperTaskProviderSettings()
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

async function setup(mode: 'failure' | 'hold') {
  let signalRequest = (): void => undefined
  const requestStarted = new Promise<void>((resolveRequest) => { signalRequest = resolveRequest })
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (mode === 'failure') {
        response.writeHead(400, { 'content-type': 'application/json', connection: 'close' })
        response.end(JSON.stringify({ error: { message: MARKER } }))
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
  return { service, root, requestStarted }
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
