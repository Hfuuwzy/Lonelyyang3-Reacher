/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { preparedExtractionFixture } from '../fixtures/paper-task-source'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import { clearPaperTaskProviderSettings } from '../../server/paper-task/provider-settings'
import type { PaperTaskRuntime, PaperTaskRuntimeFactory, PaperTaskRuntimeOptions } from '../../server/paper-task/runtime'
import type { PaperTaskMultipartInput } from '../../server/paper-task/multipart'
import type { PaperExtractionResult, ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { validatePaperTaskEvent, type PaperTaskBranch, type PaperTaskEvent } from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3])

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
  readonly closeFailsOnce?: boolean
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
          yield { type: 'preview', paragraphs: event.paragraphs ?? ['样例段落'], pieces: [] }
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
      if (spec.closeFailsOnce === true && handle.closeCalls === 1) return { ok: false }
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
  return async () => preparedExtractionFixture(result)
}

let roots: string[] = []

function service(deps: { factory: PaperTaskRuntimeFactory; extraction?: PaperExtractionResult }): PaperTaskService {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-coordinator-'))
  roots.push(root)
  return createPaperTaskService({
    projectRoot: root,
    runtimeFactory: deps.factory,
    prepareSource: extractor(deps.extraction ?? SUCCESS_EXTRACTION),
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
  clearPaperTaskProviderSettings()
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots = []
})

describe('paper-task coordinator submit', () => {
  it('uses a distinct configuration-required response before creating a task', async () => {
    clearPaperTaskProviderSettings()
    const root = mkdtempSync(join(tmpdir(), 'paper-task-unconfigured-'))
    roots.push(root)
    const svc = createPaperTaskService({ projectRoot: root })

    await expect(svc.submit(input('both'))).resolves.toMatchObject({
      ok: false,
      statusCode: 409,
      message: expect.stringContaining('API 密钥'),
    })
    expect(existsSync(root)).toBe(true)
    expect(existsSync(join(root, 'project-local'))).toBe(false)
  })

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

  it('runs without a subscriber and retains separate task history and replayable results', async () => {
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['第一篇论文的样例。'] }] },
      { branch: 'deep-reading', events: [{ type: 'preview', paragraphs: ['第二篇论文的样例。'] }], ok: false },
    ])
    const ids = [TASK_ID, '223e4567-e89b-12d3-a456-426614174000']
    const root = mkdtempSync(join(tmpdir(), 'paper-task-history-'))
    roots.push(root)
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => ids.shift() ?? '323e4567-e89b-12d3-a456-426614174000',
    })

    const first = await svc.submit(input('translation'), { sourceTitle: 'first-paper.pdf' })
    const second = await svc.submit(input('deep-reading'), { sourceTitle: 'second-paper.pdf' })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    // Neither submission stream has been consumed. The service owns both jobs.
    await waitFor(() => svc.history().some((task) => task.taskId === first.taskId && task.status === 'success'))
    await waitFor(() => svc.history().some((task) => task.taskId === second.taskId && task.status === 'fail'))

    const replayedFirst = await collect(svc.events(first.taskId)!)
    expect(replayedFirst.map((event) => event.type)).toContain('preview')
    expect(terminalOf(replayedFirst)).toMatchObject({ outcome: 'succeeded' })

    const history = svc.history()
    expect(history.map(({ taskId, sourceTitle, status }) => ({ taskId, sourceTitle, status }))).toEqual([
      { taskId: second.taskId, sourceTitle: 'second-paper.pdf', status: 'fail' },
      { taskId: first.taskId, sourceTitle: 'first-paper.pdf', status: 'success' },
    ])
    expect(history.every((task) => Number.isFinite(Date.parse(task.createdAt)))).toBe(true)
    expect(history[0]?.branches).toEqual({ translation: 'not-selected', 'deep-reading': 'failed' })
    expect(handles).toHaveLength(2)
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
      prepareSource: extractor(SUCCESS_EXTRACTION),
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
    expect(existsSync(join(workspace, 'drafts', 'translation', 'draft.json'))).toBe(true)
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
      prepareSource: extractor(SUCCESS_EXTRACTION),
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

  it('stops an active task, waits for runtime cleanup to settle, then deletes the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-active-delete-'))
    roots.push(root)
    const closeGate = deferred()
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [], hang: true, closeGate: closeGate.promise },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const { done } = startCollecting(submission.events)
    const removal = svc.remove(TASK_ID)
    await waitFor(() => handles[0]?.closeCalls === 1)
    let removalSettled = false
    void removal.then(() => { removalSettled = true })
    await Promise.resolve()
    expect(removalSettled).toBe(false)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)

    closeGate.resolve()
    const removeResult = await removal
    expect(removeResult).toEqual({ ok: true, code: 'deleted' })
    await done
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)
  })

  it('removes task-owned data from public reads and disk without affecting other jobs or downloads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-delete-public-'))
    roots.push(root)
    const otherTaskId = '223e4567-e89b-12d3-a456-426614174000'
    const otherTaskRoot = join(root, 'project-local', otherTaskId)
    const downloadsRoot = join(root, 'downloads')
    mkdirSync(otherTaskRoot, { recursive: true })
    mkdirSync(downloadsRoot, { recursive: true })
    writeFileSync(join(otherTaskRoot, 'original.pdf'), 'other task')
    writeFileSync(join(downloadsRoot, 'saved.md'), 'user download')

    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['任务资料'] }], ok: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) throw new Error('submit failed')
    await collect(submission.events)

    const ownedRoot = join(root, 'project-local', TASK_ID)
    writeFileSync(join(ownedRoot, 'drafts', 'translation', 'owned-artifact.md'), 'owned artifact')
    const staleRuntimeHome = join(root, 'runtime-local', TASK_ID, 'translation')
    mkdirSync(staleRuntimeHome, { recursive: true })
    writeFileSync(join(staleRuntimeHome, 'owned-runtime-data'), 'runtime data')
    expect(svc.history()).toHaveLength(1)
    expect(svc.events(TASK_ID)).toBeDefined()
    expect(svc.source(TASK_ID)).toBeDefined()
    expect(svc.originalPdf(TASK_ID)).toEqual(PDF_BYTES)

    expect(await svc.remove('../../' + otherTaskId)).toEqual({ ok: false, code: 'not-found' })
    expect(existsSync(join(otherTaskRoot, 'original.pdf'))).toBe(true)
    expect(existsSync(ownedRoot)).toBe(true)

    expect(await svc.remove(TASK_ID)).toEqual({ ok: true, code: 'deleted' })
    expect(svc.history()).toEqual([])
    expect(svc.events(TASK_ID)).toBeUndefined()
    expect(svc.source(TASK_ID)).toBeUndefined()
    expect(svc.translation(TASK_ID)).toBeUndefined()
    expect(svc.reader(TASK_ID)).toBeUndefined()
    expect(svc.originalPdf(TASK_ID)).toBeUndefined()
    expect(svc.translatedPdf(TASK_ID)).toBeUndefined()
    expect(svc.asset(TASK_ID, 'asset-00000000000000000000000000000000')).toBeUndefined()
    expect(existsSync(ownedRoot)).toBe(false)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(otherTaskRoot, 'original.pdf'))).toBe(true)
    expect(existsSync(join(downloadsRoot, 'saved.md'))).toBe(true)

    const afterRestart = createPaperTaskService({ projectRoot: root, runtimeFactory: factory })
    expect(afterRestart.history()).toEqual([])
    expect(afterRestart.source(TASK_ID)).toBeUndefined()
    expect(afterRestart.originalPdf(TASK_ID)).toBeUndefined()
  })

  it('keeps failed workspace cleanup traceable and allows a later service to retry deletion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-delete-retry-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['保留资料'] }], ok: true },
    ])
    let failCleanup = true
    const removeWorkspace = (workspaceRoot: string) => {
      if (failCleanup) {
        failCleanup = false
        throw new Error('injected workspace cleanup failure')
      }
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
      removeWorkspace,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) throw new Error('submit failed')
    await collect(submission.events)

    expect(await svc.remove(TASK_ID)).toEqual({ ok: false, code: 'cleanup-failed' })
    expect(svc.history()).toHaveLength(1)
    expect(svc.history()[0]).toMatchObject({ taskId: TASK_ID, deletionPending: true })
    expect(svc.source(TASK_ID)).toBeDefined()
    expect(svc.originalPdf(TASK_ID)).toEqual(PDF_BYTES)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)

    const restored = createPaperTaskService({ projectRoot: root, runtimeFactory: factory, removeWorkspace })
    expect(restored.history()).toMatchObject([{ taskId: TASK_ID, deletionPending: true }])
    expect(restored.source(TASK_ID)).toBeDefined()
    expect(restored.originalPdf(TASK_ID)).toEqual(PDF_BYTES)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
    expect(await restored.remove(TASK_ID)).toEqual({ ok: true, code: 'deleted' })
    expect(restored.history()).toEqual([])
    expect(restored.source(TASK_ID)).toBeUndefined()
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)

    const afterRetry = createPaperTaskService({ projectRoot: root, runtimeFactory: factory })
    expect(afterRetry.history()).toEqual([])
    expect(afterRetry.source(TASK_ID)).toBeUndefined()
    expect(afterRetry.originalPdf(TASK_ID)).toBeUndefined()
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)
  })

  it('retries a transient runtime cleanup failure before deleting task data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-runtime-delete-retry-'))
    roots.push(root)
    const { factory } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['清理可重试'] }], closeFailsOnce: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) throw new Error('submit failed')
    await collect(submission.events)

    expect(await svc.remove(TASK_ID)).toEqual({ ok: true, code: 'deleted' })
    expect(svc.history()).toEqual([])
    expect(svc.source(TASK_ID)).toBeUndefined()
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

  it('starts accepted work without a subscriber and explicit cancellation awaits cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-task-unconsumed-cancel-'))
    roots.push(root)
    const { factory, handles } = fakeRuntimeFactory([
      { branch: 'translation', events: [{ type: 'preview', paragraphs: ['取消前保留的预览。'] }], hang: true },
    ])
    const svc = createPaperTaskService({
      projectRoot: root,
      runtimeFactory: factory,
      prepareSource: extractor(SUCCESS_EXTRACTION),
      createId: () => TASK_ID,
    })
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await waitFor(() => handles.length === 1)
    expect(svc.history()[0]).toMatchObject({
      taskId: TASK_ID,
      status: 'running',
      branches: { translation: 'running', 'deep-reading': 'not-selected' },
    })

    expect(await svc.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
    const events = await collect(submission.events)
    expect(terminalOf(events)).toMatchObject({ outcome: 'cancelled', branches: { translation: 'cancelled' } })
    expect(svc.history()[0]).toMatchObject({ status: 'stopped', branches: { translation: 'cancelled' } })
    expect(handles[0]?.closeCalls).toBeGreaterThan(0)
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
          yield { type: 'preview', paragraphs: ['完成'], pieces: [] }
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
      prepareSource: extractor(SUCCESS_EXTRACTION),
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
    expect(terminalOf(collected)).toMatchObject({
      type: 'terminal',
      outcome: 'cancelled',
      branches: { translation: 'sample-ready', 'deep-reading': 'failed' },
    })
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
      prepareSource: extractor(SUCCESS_EXTRACTION),
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
      prepareSource: extractor(SUCCESS_EXTRACTION),
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
    expect(svc.history()[0]).toMatchObject({
      status: 'running',
      branches: { translation: 'sample-ready', 'deep-reading': 'running' },
    })
    await svc.cancel(TASK_ID)
    await done
  })

  it('keeps runtimes alive when one observer returns early; explicit cancel closes them', async () => {
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
    if (iterator.return === undefined) throw new Error('task iterator must support early return')
    await iterator.return()
    for (const handle of handles) {
      expect(handle.closeCalls).toBe(0)
    }
    expect(svc.history()[0]).toMatchObject({
      status: 'running',
      branches: { translation: 'sample-ready', 'deep-reading': 'not-selected' },
    })
    expect(await svc.cancel(TASK_ID)).toEqual({ ok: true, code: 'stopped' })
    for (const handle of handles) {
      expect(handle.closeCalls).toBeGreaterThan(0)
    }
  })
})

describe('paper-task artifact retrieval after source correction', () => {
  it('serves each selected task branch as its own full reader Markdown and download artifact', async () => {
    const markdownByBranch = {
      translation: '# 翻译主稿\n\n翻译正文第一段。\n\n## 完整方法\n\n翻译正文第二段。',
      'deep-reading': '# 深读报告\n\n报告正文第一段。\n\n## 研究边界\n\n报告正文第二段。',
    } as const
    const factory: PaperTaskRuntimeFactory = (options) => {
      const branch = options.branch
      const markdown = markdownByBranch[branch]
      const directory = options.branchWorkspaceDir
      if (directory === undefined) throw new Error('branch workspace unavailable')

      if (branch === 'translation') {
        writeFileSync(join(directory, 'master.md'), markdown)
        writeFileSync(join(directory, 'translation.json'), JSON.stringify({
          version: 1,
          status: 'complete',
          sourceRevision: 1,
          masterSha256: createHash('sha256').update(markdown).digest('hex'),
          segments: [{
            index: 0,
            markdown,
            stale: false,
            dependencies: [{ recordId: 'p1-r0', revision: 1 }, { recordId: 'p1-r1', revision: 1 }],
          }],
          assets: [],
          unresolved: [],
        }))
      } else {
        writeFileSync(join(directory, 'report.md'), markdown)
        writeFileSync(join(directory, 'preview.md'), markdown)
        writeFileSync(join(directory, 'evidence.json'), JSON.stringify({
          manuscriptSha256: createHash('sha256').update(markdown).digest('hex'),
          status: 'needs-confirmation',
          claims: [],
          assets: [],
          uncompletedReasons: [],
          unresolvedRecordIds: [],
          unverifiedAssetIds: [],
        }))
      }

      return {
        events: async function* () {
          yield {
            type: 'generated-preview',
            markdown,
            paragraphs: [markdown],
            quality: { status: 'needs-confirmation', issues: [], options: [] },
          }
        },
        result: Promise.resolve({ ok: true }),
        close: async () => ({ ok: true }),
      }
    }
    const svc = service({ factory })
    const submission = await svc.submit({ pdf: new Uint8Array(Buffer.from('%PDF-1.4\nfixture')), selection: 'both' })
    if (!submission.ok) throw new Error('submit failed')
    await collect(submission.events)

    const reader = svc.reader(TASK_ID)
    expect(reader?.taskId).toBe(TASK_ID)
    expect(reader?.documents.map(({ branch, markdown }) => ({ branch, markdown }))).toEqual([
      { branch: 'translation', markdown: markdownByBranch.translation },
      { branch: 'deep-reading', markdown: markdownByBranch['deep-reading'] },
    ])

    for (const branch of ['translation', 'deep-reading'] as const) {
      const built = await svc.buildArtifacts(TASK_ID, branch, ['markdown'])
      expect(built?.documents.find((document) => document.branch === branch)?.markdown).toBe(markdownByBranch[branch])
      expect(svc.artifact(TASK_ID, branch, 'markdown')?.toString('utf8')).toBe(markdownByBranch[branch])
    }
  })

  it('blocks final retrieval of an inspected PDF after its complete translation master becomes stale', async () => {
    const master = '# 完整译文\n\n本文完整说明了研究问题、研究方法、实验结果、数据解释和研究结论。'
    const originalPdf = new Uint8Array(Buffer.from('%PDF-1.4\noriginal fixture'))
    const factory: PaperTaskRuntimeFactory = (options) => {
      const directory = options.branchWorkspaceDir
      if (directory === undefined) throw new Error('branch workspace unavailable')
      writeFileSync(join(directory, 'master.md'), master)
      writeFileSync(join(directory, 'translation.json'), JSON.stringify({
        version: 1,
        status: 'complete',
        sourceRevision: 1,
        masterSha256: createHash('sha256').update(master).digest('hex'),
        segments: [{
          index: 0,
          markdown: master,
          stale: false,
          dependencies: [{ recordId: 'p1-r0', revision: 1 }, { recordId: 'p1-r1', revision: 1 }],
        }],
        assets: [],
        unresolved: [],
      }))
      return {
        events: async function* () {
          yield {
            type: 'generated-preview',
            markdown: master,
            paragraphs: [master],
            quality: { status: 'complete', issues: [], options: [] },
          }
        },
        result: Promise.resolve({ ok: true }),
        close: async () => ({ ok: true }),
      }
    }
    const svc = service({ factory })
    const submission = await svc.submit({ pdf: originalPdf, selection: 'translation' })
    if (!submission.ok) throw new Error('submit failed')
    await collect(submission.events)

    const built = await svc.buildArtifacts(TASK_ID, 'translation', ['pdf'])
    const expectedPageCount = built?.documents[0]?.formats.pdf.expectedPageCount
    if (expectedPageCount === undefined) throw new Error('expected PDF page count')
    const artifactSha256 = built?.documents[0]?.formats.pdf.artifactSha256
    if (artifactSha256 === undefined) throw new Error('expected PDF artifact hash')
    const inspection = {
      artifactSha256,
      expectedPageCount,
      pages: Array.from({ length: expectedPageCount }, (_, index) => ({
        page: index + 1,
        status: 'passed' as const,
        expected: `Page ${index + 1} contains the complete translation.`,
        observed: `Page ${index + 1} contains the complete translation.`,
        evidence: `Inspected the actual rendered page ${index + 1}.`,
      })),
    }
    const inspected = await svc.inspectArtifact(TASK_ID, 'translation', 'pdf', inspection)
    expect(inspected?.documents[0]?.formats.pdf.finalAvailable).toBe(true)
    expect(svc.artifact(TASK_ID, 'translation', 'pdf')).toBeDefined()

    expect(svc.correctSource(TASK_ID, {
      expectedSourceRevision: 1,
      corrections: [{ recordId: 'p1-r1', expectedRecordRevision: 1, text: 'Corrected authored content line.' }],
    })).toEqual({ kind: 'corrected', revision: 2 })

    expect(svc.reader(TASK_ID)?.documents[0]?.formats.pdf).toMatchObject({
      status: 'needs-confirmation',
      build: 'built',
      inspectionAvailable: true,
      finalAvailable: false,
    })
    expect(svc.artifact(TASK_ID, 'translation', 'pdf')).toBeUndefined()
    expect(svc.originalPdf(TASK_ID)).toEqual(originalPdf)
    expect(svc.translatedPdf(TASK_ID)).toBeUndefined()
  }, 15_000)
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
