/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings, replacePaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'
import { paperTaskProviderSettingsSchema } from '../../app/utils/paper-task-provider-contract'
import { preparedExtractionFixture } from '../fixtures/paper-task-source'
import { callsAndResults, closeServer, listenLoopback, pageSchema, respond, type Decision, type FixtureBody } from '../fixtures/paper-task-protocol'
import { DEEP_RESOURCES, TRANSLATION_RESOURCES, SOURCE_TEXT, REPORT, CLAIMS } from '../fixtures/paper-task-deep-reading'

const TASK_ID = '7e1f1b50-40ac-49f6-a4fb-7bf92945a221'
const fixtures: { readonly root: string; readonly service: PaperTaskService; readonly server: Server }[] = []
const savedDeepRoot = process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT
const savedTranslationRoot = process.env.PAPER_TASK_TRANSLATION_SKILL_ROOT

afterEach(async () => {
  clearPaperTaskProviderSettings()
  for (const fixture of fixtures.splice(0)) {
    await fixture.service.cancel(TASK_ID)
    await fixture.service.remove(TASK_ID)
    await closeServer(fixture.server)
    rmSync(fixture.root, { recursive: true, force: true })
  }
  for (const [key, value] of Object.entries({ PAPER_TASK_DEEP_READING_SKILL_ROOT: savedDeepRoot, PAPER_TASK_TRANSLATION_SKILL_ROOT: savedTranslationRoot })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('paper-task deep-reading pinned DSH integration', () => {
  it('retains a whole-paper natural Chinese report beyond the wire excerpt without selecting translation', async () => {
    // Given the actual pinned SDK/CLI and a keyless protocol peer.
    const fixture = await setup()
    // When only deep reading is submitted.
    const events = await collect(fixture.service)
    // Then the full report and grounded key passages survive runtime cleanup.
    assertReport(fixture.root, events)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'succeeded', branches: { translation: 'not-selected', 'deep-reading': 'preview-ready' }, cleanup: 'clean' })
    const transcript = callsAndResults(fixture.received.at(-1) ?? { model: 'fixture' })
    expect(transcript.filter((call) => call.name === 'paper_task_read_source').map((call) => call.arguments.record_id)).toEqual(['p1-r0', 'p1-r1', 'p1-r2', 'p2-r3', 'p2-r4', 'p2-r5'])
    expect(transcript.filter((call) => call.name === 'paper_task_read_resource').map((call) => call.arguments.resource_id)).toEqual(['deep-reading:SKILL.md', 'deep-reading:references:critical_thinking.md'])
    expect(fixture.received[0]?.tools?.map((tool) => tool.function.name).sort()).toEqual(['paper_task_list_resources', 'paper_task_list_sources', 'paper_task_read_branch', 'paper_task_read_input', 'paper_task_read_resource', 'paper_task_read_source', 'paper_task_write_branch'])
  }, 45000)

  it('publishes deep reading before deferred translation ends and retains it after sibling failure', async () => {
    // Given a translation peer that cannot finish before a deep-reading preview.
    let releaseTranslation = (): void => undefined
    const gate = new Promise<void>((resolveGate) => { releaseTranslation = resolveGate })
    const fixture = await setup(gate)
    const submission = await fixture.service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'both' })
    if (!submission.ok) throw new Error('fixture submission rejected')
    const events: PaperTaskEvent[] = []
    // When both branches run, release translation only after observing deep reading.
    try {
      for await (const event of submission.events) {
        events.push(event)
        if (event.type === 'preview' && event.branch === 'deep-reading') releaseTranslation()
      }
    } finally { releaseTranslation() }
    // Then translation failure cannot erase the independently usable report.
    assertReport(fixture.root, events)
    expect(events.at(-1)).toMatchObject({ type: 'terminal', outcome: 'failed', branches: { translation: 'failed', 'deep-reading': 'preview-ready' }, cleanup: 'clean' })
  }, 45000)
})

async function setup(translationGate: Promise<void> = Promise.resolve()) {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-deep-dsh-'))
  const deepSkill = join(root, 'deep-skill'), translationSkill = join(root, 'translation-skill')
  writeResources(deepSkill, DEEP_RESOURCES, 'Pinned deep-reading fixture resource.')
  writeResources(translationSkill, TRANSLATION_RESOURCES, '---\nname: academic-paper-zh-translation\nversion: 1.1.0\n---\nPinned translation fixture.')
  process.env.PAPER_TASK_DEEP_READING_SKILL_ROOT = deepSkill
  process.env.PAPER_TASK_TRANSLATION_SKILL_ROOT = translationSkill
  const received: FixtureBody[] = []
  const server = createServer((request, response) => {
    void respond(request, response, { translationGate, choose: (body) => {
      if ((body.tools ?? []).length === 0) return { content: 'initialized' }
      if (JSON.stringify(body.tools).includes('claim_evidence')) {
        received.push(body)
        return deepDecision(body)
      }
      return { content: 'Translation deliberately produces no draft.' }
    } }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error
      response.writeHead(500).end()
    })
  })
  const service = createPaperTaskService({
    projectRoot: root, createId: () => TASK_ID,
    prepareSource: async () => preparedExtractionFixture({ success: true, pageCount: 2, pages: [0, 1].map((index) => {
      const lines = SOURCE_TEXT.slice(index * 3, index * 3 + 3)
      return { readerPage: index + 1, lines: lines.map((text) => ({ text, isHeading: false })), headings: [], text: lines.join('\n') }
    }) }),
  })
  fixtures.push({ root, server, service })
  replacePaperTaskProviderSettings(paperTaskProviderSettingsSchema.parse({ providerLabel: 'Local protocol fixture', baseUrl: await listenLoopback(server), protocol: 'openai-completions', model: 'paper-task-fixture', apiKey: '' }))
  return { root, service, received }
}

function deepDecision(body: FixtureBody): Decision {
  const calls = callsAndResults(body)
  for (const name of ['paper_task_read_input', 'paper_task_list_resources', 'paper_task_list_sources']) {
    if (!calls.some((call) => call.name === name && call.output !== undefined)) return { tool: name, arguments: {} }
  }
  const listed = calls.find((call) => call.name === 'paper_task_list_sources')?.output
  if (listed === undefined) throw new Error('source listing missing')
  const ids = z.object({ items: z.array(z.string()) }).parse(JSON.parse(listed)).items
  for (const [name, key, values] of [
    ['paper_task_read_resource', 'resource_id', ['deep-reading:SKILL.md', 'deep-reading:references:critical_thinking.md']],
    ['paper_task_read_source', 'record_id', ids],
  ] as const) {
    for (const value of values) {
      const output = calls.filter((call) => call.name === name && call.arguments[key] === value).at(-1)?.output
      const page = output === undefined ? undefined : pageSchema.parse(JSON.parse(output))
      if (page === undefined || page.nextOffset < page.totalBytes) return { tool: name, arguments: { [key]: value, offset: page?.nextOffset ?? 0 } }
    }
  }
  if (!calls.some((call) => call.name === 'paper_task_write_branch')) return { tool: 'paper_task_write_branch', arguments: { markdown: REPORT, source_record_ids: ids, claim_evidence: CLAIMS, uncompleted_reasons: ['第二学年失访机制尚未核实。'] } }
  return { content: 'The unfinished draft is saved.' }
}

async function collect(service: PaperTaskService): Promise<readonly PaperTaskEvent[]> {
  const submission = await service.submit({ pdf: new Uint8Array([37, 80, 68, 70]), selection: 'deep-reading' })
  if (!submission.ok) throw new Error('fixture submission rejected')
  const events: PaperTaskEvent[] = []
  for await (const event of submission.events) events.push(event)
  return events
}

function assertReport(root: string, events: readonly PaperTaskEvent[]): void {
  const directory = join(root, 'project-local', TASK_ID, 'drafts', 'deep-reading')
  expect(readFileSync(join(directory, 'report.md'), 'utf8')).toBe(REPORT)
  expect(readFileSync(join(directory, 'preview.md'), 'utf8')).toBe(REPORT)
  expect(REPORT).not.toMatch(/p\d+-r\d+/)
  const evidence = z.object({ status: z.literal('needs-confirmation'), claims: z.array(z.object({ passage: z.string(), kind: z.enum(['fact', 'inference']), evidence: z.array(z.object({ recordId: z.string(), revision: z.number(), quote: z.string() })) })) }).parse(JSON.parse(readFileSync(join(directory, 'evidence.json'), 'utf8')))
  expect(evidence.claims).toEqual(CLAIMS.map((claim) => ({ passage: claim.passage, kind: claim.kind, evidence: [{ recordId: claim.source_record_id, revision: 1, quote: claim.quote }] })))
  const preview = events.find((event) => event.type === 'preview' && event.branch === 'deep-reading')
  if (preview?.type !== 'preview') throw new Error('deep-reading preview missing')
  expect(preview.designation).toBe('generated-preview')
  expect(preview.paragraphs).toHaveLength(8)
  expect(preview.paragraphs.join('\n\n')).not.toBe(REPORT)
  expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
}

function writeResources(root: string, files: readonly string[], skill: string): void {
  for (const path of files) {
    const target = join(root, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, path === 'SKILL.md' ? skill : `Pinned framework instructions for ${path}.`)
  }
}
