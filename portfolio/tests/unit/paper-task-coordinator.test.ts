import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import type { PaperTaskRuntime, PaperTaskRuntimeFactory, PaperTaskRuntimeOptions } from '../../server/paper-task/runtime'
import type { PaperTaskMultipartInput } from '../../server/paper-task/multipart'
import type { PaperExtractionResult, ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { validatePaperTaskEvent, type PaperTaskBranch, type PaperTaskEvent } from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])

const PAGE: ExtractedPaperPage = {
  readerPage: 1,
  lines: [{ text: 'fixture heading', isHeading: true }],
  headings: ['fixture heading'],
  text: 'fixture heading\nauthored content line',
}

const SUCCESS_EXTRACTION: PaperExtractionResult = { success: true, pageCount: 1, pages: [PAGE] }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

interface FakeRuntimeSpec {
  readonly branch: PaperTaskBranch
  readonly events: Array<{ readonly type: 'progress' | 'preview'; readonly stage?: 'preparing' | 'generating' | 'cleaning'; readonly completed?: number; readonly total?: number; readonly paragraphs?: readonly string[] }>
  readonly hang?: boolean
  readonly ok?: boolean
  readonly closeOk?: boolean
  readonly closeGate?: Promise<void>
  readonly closeThrows?: boolean
}

interface FakeRuntimeHandle {
  readonly spec: FakeRuntimeSpec
  closeCalls: number
  readonly released: Promise<void>
  readonly release: () => void
}

function makeFakeRuntime(spec: FakeRuntimeSpec): { runtime: PaperTaskRuntime; handle: FakeRuntimeHandle } {
  let resolveResult!: (result: { ok: boolean }) => void
  let release!: () => void
  const released = new Promise<void>((res) => {
    release = res
  })
  const result = new Promise<{ ok: boolean }>((res) => {
    resolveResult = res
  })
  const handle: FakeRuntimeHandle = { spec, closeCalls: 0, released, release }
  const runtime: PaperTaskRuntime = {
    events: async function* () {
      for (const event of spec.events) {
        if (event.type === 'progress') {
          yield { type: 'progress', stage: event.stage ?? 'generating', completed: event.completed ?? 0, total: event.total ?? 1 }
        } else {
          yield { type: 'preview', paragraphs: event.paragraphs ?? ['样例段落'] }
        }
      }
      if (spec.hang === true) {
        await released
      }
      resolveResult({ ok: spec.hang === true ? false : (spec.ok ?? true) })
    },
    result,
    close: async () => {
      handle.closeCalls += 1
      release()
      await spec.closeGate
      if (spec.closeThrows === true) {
        throw new Error('close failed')
      }
      return { ok: spec.closeOk ?? true }
    },
  }
  return { runtime, handle }
}

function fakeRuntimeFactory(specs: readonly FakeRuntimeSpec[]): { factory: PaperTaskRuntimeFactory; handles: FakeRuntimeHandle[] } {
  const byBranch = new Map<PaperTaskBranch, FakeRuntimeHandle>()
  const handles: FakeRuntimeHandle[] = []
  const factory: PaperTaskRuntimeFactory = (options: PaperTaskRuntimeOptions) => {
    const spec = specs.find((s) => s.branch === options.branch)
    if (spec === undefined) {
      throw new Error('no fake runtime spec for branch')
    }
    const made = makeFakeRuntime(spec)
    byBranch.set(options.branch, made.handle)
    handles.push(made.handle)
    return made.runtime
  }
  return { factory, handles }
}

function input(selection: 'translation' | 'deep-reading' | 'both'): PaperTaskMultipartInput {
  return { pdf: PDF_BYTES, selection }
}

function extractor(result: PaperExtractionResult) {
  return async (): Promise<PaperExtractionResult> => result
}

let roots: string[] = []

function service(deps: { factory: PaperTaskRuntimeFactory; extraction?: PaperExtractionResult }): PaperTaskService {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-coordinator-'))
  roots.push(root)
  return createPaperTaskService({
    projectRoot: root,
    runtimeFactory: deps.factory,
    extractPaperPages: extractor(deps.extraction ?? SUCCESS_EXTRACTION),
    createId: () => TASK_ID,
  })
}

async function collect(events: AsyncIterable<PaperTaskEvent>): Promise<readonly PaperTaskEvent[]> {
  const collected: PaperTaskEvent[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

function startCollecting(events: AsyncIterable<PaperTaskEvent>): { events: readonly PaperTaskEvent[]; done: Promise<readonly PaperTaskEvent[]> } {
  const collected: PaperTaskEvent[] = []
  const done = (async () => {
    for await (const event of events) {
      collected.push(event)
    }
    return collected
  })()
  return { events: collected, done }
}

function terminalOf(events: readonly PaperTaskEvent[]): PaperTaskEvent {
  const terminal = events.at(-1)
  if (terminal === undefined || terminal.type !== 'terminal') {
    throw new Error('expected a terminal event')
  }
  return terminal
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots = []
})

describe('paper-task coordinator submit', () => {
  it('streams accepted, preparing, generating, preview, cleaning, and a succeeded terminal', async () => {
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'progress', stage: 'generating', completed: 0, total: 1 }, { type: 'preview', paragraphs: ['样例译文段落。'] }], ok: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('translation'))
    expect(submission.ok).toBe(true)
    if (!submission.ok) {
      return
    }
    const events = await collect(submission.events)
    expect(events.map((e) => e.type)).toEqual(['accepted', 'progress', 'progress', 'progress', 'preview', 'progress', 'progress', 'terminal'])
    expect(events[0]).toEqual({ type: 'accepted', taskId: TASK_ID, selection: 'translation' })
    const terminal = terminalOf(events)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('succeeded')
      expect(terminal.branches).toEqual({ translation: 'sample-ready', 'deep-reading': 'not-selected' })
      expect(terminal.cleanup).toBe('clean')
    }
  })

  it('emits only events valid for the selected branches', async () => {
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'progress', completed: 0, total: 1 }, { type: 'preview', paragraphs: ['a'] }], ok: true },
      { branch: 'deep-reading', events: [{ type: 'preview', paragraphs: ['b'] }], ok: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    for (const event of await collect(submission.events)) {
      expect(validatePaperTaskEvent(event, 'both')).toBe(true)
    }
  })

  it('persists the original PDF, work context, drafts, and assets in the retained workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-workspace-check-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['样例'] }], ok: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await collect(submission.events)
    const workspace = join(root, 'project-local', TASK_ID)
    expect(existsSync(join(workspace, 'original.pdf'))).toBe(true)
    expect(existsSync(join(workspace, 'work-context.json'))).toBe(true)
    expect(existsSync(join(workspace, 'drafts', 'translation.json'))).toBe(true)
    expect(existsSync(join(workspace, 'assets'))).toBe(true)
  })
})

describe('paper-task coordinator failure and cancel paths', () => {
  it('ends in a failed terminal when extraction fails, without spawning runtimes', async () => {
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [], ok: true },
    ])
    const svc = service({ factory, extraction: { success: false, error: { code: 'invalid-pdf', message: 'raw', recoverable: false } } })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const events = await collect(submission.events)
    expect(events.map((e) => e.type)).toEqual(['accepted', 'progress', 'progress', 'progress', 'terminal'])
    const terminal = terminalOf(events)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('failed')
      expect(terminal.branches).toEqual({ translation: 'failed', 'deep-reading': 'not-selected' })
    }
    expect(handles).toHaveLength(0)
  })

  it('marks a failed sibling while keeping the other sample-ready', async () => {
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['译'] }], ok: false },
      { branch: 'deep-reading', events: [{ type: 'preview', paragraphs: ['读'] }], ok: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const events = await collect(submission.events)
    const terminal = terminalOf(events)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('failed')
      expect(terminal.branches).toEqual({ translation: 'failed', 'deep-reading': 'sample-ready' })
    }
  })

  it('cancels a running task: unfinished branch cancelled, finished sibling sample-ready', async () => {
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['已完成'] }], ok: true },
      { branch: 'deep-reading', events: [], hang: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { events, done } = startCollecting(submission.events)
    await waitForEvent(events, (e) => e.type === 'preview')
    const cancelResult = await svc.cancel(TASK_ID)
    expect(cancelResult).toEqual({ ok: true, code: 'stopped' })
    const collected = await done
    const terminal = terminalOf(collected)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('cancelled')
      expect(terminal.branches).toEqual({ translation: 'sample-ready', 'deep-reading': 'cancelled' })
    }
    for (const handle of handles) {
      expect(handle.closeCalls).toBeGreaterThan(0)
    }
  })

  it('returns not-found for an unknown cancel or delete', async () => {
    const { factory } = fakeRuntimeFactory([])
    const svc = service({ factory })
    expect(await svc.cancel('unknown')).toEqual({ ok: false, code: 'not-found' })
    expect(await svc.remove('unknown')).toEqual({ ok: false, code: 'not-found' })
  })
})

describe('paper-task coordinator deletion', () => {
  it('deletes a finished task and removes the retained workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-delete-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['删除前的预览'] }], ok: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await collect(submission.events)
    expect(await svc.remove(TASK_ID)).toEqual({ ok: true, code: 'deleted' })
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)
  })

  it('stops an active task, awaits cleanup, then deletes the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-active-delete-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [], hang: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { done } = startCollecting(submission.events)
    const removeResult = await svc.remove(TASK_ID)
    expect(removeResult).toEqual({ ok: true, code: 'deleted' })
    await done
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)
  })

  it('settles cancellation while the event consumer is paused after a preview', async () => {
    const closeGate = deferred()
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['已完成'] }], closeGate: closeGate.promise },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const iterator = submission.events[Symbol.asyncIterator]()
    let event = await iterator.next()
    while (!event.done && event.value.type !== 'preview') {
      event = await iterator.next()
    }
    const cancel = svc.cancel(TASK_ID)
    await waitFor(() => handles[0]?.closeCalls === 1)
    let cancelSettled = false
    void cancel.then(() => { cancelSettled = true })
    await Promise.resolve()
    expect(cancelSettled).toBe(false)
    closeGate.resolve()
    expect(await cancel).toEqual({ ok: true, code: 'stopped' })
  })

  it('does not start a never-consumed task after cancellation finalizes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-unconsumed-cancel-'))
    roots.push(root)
    let factoryCalls = 0
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: () => {
        factoryCalls += 1
        throw new Error('runtime factory must stay fenced')
      },
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    expect(await svc.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
    expect(await submission.events[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
    expect(factoryCalls).toBe(0)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
  })

  it('removes the runtime root after all runtime homes close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-runtime-root-'))
    roots.push(root)
    let runtimeHome = ''
    const factory: PaperTaskRuntimeFactory = (options) => {
      runtimeHome = options.runtimeHome
      mkdirSync(runtimeHome, { recursive: true })
      return {
        events: async function* () {
          yield { type: 'preview', paragraphs: ['完成'] }
        },
        result: Promise.resolve({ ok: true }),
        close: async () => {
          rmSync(runtimeHome, { recursive: true, force: true })
          return { ok: true }
        },
      }
    }
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await collect(submission.events)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
  })

  it('keeps a runtime created before a later factory throw under cleanup', async () => {
    const { factory: baseFactory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['保留预览'] }], hang: true },
    ])
    const factory: PaperTaskRuntimeFactory = (options) => {
      if (options.branch === 'deep-reading') {
        throw new Error('factory failed')
      }
      return baseFactory(options)
    }
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { events, done } = startCollecting(submission.events)
    await waitForEvent(events, (event) => event.type === 'preview' && event.branch === 'translation')
    await svc.cancel(TASK_ID)
    const collected = await done
    expect(collected.some((event) => event.type === 'preview' && event.branch === 'translation')).toBe(true)
    expect(terminalOf(collected)).toMatchObject({ type: 'terminal', outcome: 'cancelled', branches: { translation: 'cancelled', 'deep-reading': 'failed' } })
    expect(handles).toHaveLength(1)
    expect(handles[0]?.closeCalls).toBeGreaterThan(0)
  })

  it('closes sibling runtimes when one runtime close throws', async () => {
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['翻译预览'] }], closeThrows: true },
      { branch: 'deep-reading', events: [{ type: 'preview', paragraphs: ['深读预览'] }] },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const events = await collect(submission.events)
    expect(handles).toHaveLength(2)
    expect(handles.every((handle) => handle.closeCalls === 1)).toBe(true)
    expect(terminalOf(events)).toMatchObject({ type: 'terminal', cleanup: 'failed' })
  })

  it('does not emit terminal until delayed runtime cleanup resolves', async () => {
    const closeGate = deferred()
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['预览'] }], closeGate: closeGate.promise },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { events } = startCollecting(submission.events)
    await waitForEvent(events, (event) => event.type === 'progress' && event.stage === 'cleaning')
    await Promise.resolve()
    expect(events.some((event) => event.type === 'terminal')).toBe(false)
    closeGate.resolve()
    await waitForEvent(events, (event) => event.type === 'terminal')
    expect(handles[0]?.closeCalls).toBe(1)
  })

  it('blocks deletion when cleanup failed and retains the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-cleanup-block-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['预览'] }], closeOk: false },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await collect(submission.events)
    expect(await svc.remove(TASK_ID)).toEqual({ ok: false, code: 'cleanup-failed' })
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(true)
  })
})

describe('paper-task coordinator boundary errors', () => {
  it('returns a safe fixed error when the workspace cannot be created', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-boundary-'))
    roots.push(root)
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'file')
    const { factory } = fakeRuntimeFactory([])
    const svc = createPaperTaskService({
      projectRoot: join(blocker, 'nested'),
      runtimeFactory: factory,
      extractPaperPages: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    expect(submission.ok).toBe(false)
    if (!submission.ok) {
      expect(submission.statusCode).toBe(500)
      expect(submission.message).toBe('任务工作区创建失败，请稍后重试。')
    }
  })
})

describe('paper-task independent branches and early return', () => {
  it('interleaves branch events and emits the fast preview before the slow branch finishes', async () => {
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['快'] }], ok: true },
      { branch: 'deep-reading', events: [], hang: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { events, done } = startCollecting(submission.events)
    await waitForEvent(events, (e) => e.type === 'preview' && e.branch === 'translation')
    const previewIndex = events.findIndex((e) => e.type === 'preview')
    expect(previewIndex).toBeGreaterThan(-1)
    expect(events.some((e) => e.type === 'terminal')).toBe(false)
    await svc.cancel(TASK_ID)
    await done
  })

  it('closes every runtime when the consumer returns early', async () => {
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['预览'] }], hang: true },
    ])
    const svc = service({ factory })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const iterator = submission.events[Symbol.asyncIterator]()
    let event = await iterator.next()
    while (!event.done && event.value.type !== 'preview') {
      event = await iterator.next()
    }
    await iterator.return()
    for (const handle of handles) {
      expect(handle.closeCalls).toBeGreaterThan(0)
    }
  })
})

function waitForEvent(
  events: readonly PaperTaskEvent[],
  predicate: (event: PaperTaskEvent) => boolean,
): Promise<void> {
  return waitFor(() => events.some(predicate))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
