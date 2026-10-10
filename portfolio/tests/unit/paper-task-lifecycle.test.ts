import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { createPaperTaskService, type PaperTaskService } from '../../server/paper-task/coordinator'
import { createSampleProcessRuntimeFactory, type PaperTaskRuntime } from '../../server/paper-task/runtime'
import type { PaperTaskMultipartInput } from '../../server/paper-task/multipart'
import type { PaperExtractionResult, ExtractedPaperPage } from '../../server/utils/paper-review/pdf'
import { observeRequestDisconnect } from '../../server/utils/paper-review/disconnect'
import type { PaperTaskEvent } from '../../app/utils/paper-task-contract'

const TASK_ID = '123e4567-e89b-12d3-a456-426614174000'
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])

const PAGE: ExtractedPaperPage = {
  readerPage: 1,
  lines: [{ text: 'fixture heading', isHeading: true }, { text: 'real source line one', isHeading: false }],
  headings: ['fixture heading'],
  text: 'fixture heading\nreal source line one',
}

function successExtractor(): (bytes: Uint8Array, signal?: AbortSignal) => Promise<PaperExtractionResult> {
  return async () => ({ success: true, pageCount: 1, pages: [PAGE] })
}

function input(selection: 'translation' | 'deep-reading' | 'both'): PaperTaskMultipartInput {
  return { pdf: PDF_BYTES, selection }
}

/** Spawn a real node child whose script writes JSON events then exits 0. */
function workerScriptEventLine(event: unknown): string {
  return `process.stdout.write(${JSON.stringify(JSON.stringify(event))} + '\\n')`
}

let roots: string[] = []
let servers: Server[] = []

afterEach(async () => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots = []
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  servers = []
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-lifecycle-'))
  roots.push(root)
  return root
}

function makeService(factory: ReturnType<typeof createSampleProcessRuntimeFactory>, root: string): PaperTaskService {
  return createPaperTaskService({
    projectRoot: root,
    runtimeFactory: factory,
    extractPaperPages: successExtractor(),
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

function terminalOf(events: readonly PaperTaskEvent[]): PaperTaskEvent {
  const terminal = events.at(-1)
  if (terminal === undefined || terminal.type !== 'terminal') {
    throw new Error('expected a terminal event')
  }
  return terminal
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await once(child, 'exit')
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

describe('paper-task lifecycle — real local child processes', () => {
  it('succeeds end-to-end: worker exits 0, temp runtime removed, retained materials kept', async () => {
    const root = tempRoot()
    const spawned: ChildProcess[] = []
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath, args) => {
        const child = spawn(nodePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        spawned.push(child)
        return child
      },
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const events = await collect(submission.events)
    const terminal = terminalOf(events)
    expect(terminal.type).toBe('terminal')
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('succeeded')
      expect(terminal.branches).toEqual({ translation: 'sample-ready', 'deep-reading': 'not-selected' })
      expect(terminal.cleanup).toBe('clean')
    }
    expect(spawned).toHaveLength(1)
    await waitForExit(spawned[0]!)
    expect(spawned[0]!.exitCode).toBe(0)

    const workspace = join(root, 'project-local', TASK_ID)
    expect(existsSync(join(workspace, 'original.pdf'))).toBe(true)
    expect(existsSync(join(workspace, 'work-context.json'))).toBe(true)
    expect(existsSync(join(workspace, 'drafts', 'translation.json'))).toBe(true)
    expect(statSync(join(workspace, 'assets')).isDirectory()).toBe(true)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)

    const draft = JSON.parse(readFileSync(join(workspace, 'drafts', 'translation.json'), 'utf8')) as { paragraphs: string[] }
    expect(draft.paragraphs.length).toBeGreaterThan(0)
    expect(draft.paragraphs[0]?.includes('样例')).toBe(true)
    expect(JSON.stringify(draft)).not.toContain('complete')
  })

  it('marks the branch failed when the child exits non-zero and still cleans up', async () => {
    const root = tempRoot()
    const spawned: ChildProcess[] = []
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath) => {
        const script = `${workerScriptEventLine({ type: 'progress', stage: 'generating', completed: 0, total: 1 })}\nprocess.exit(3)`
        const child = spawn(nodePath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        spawned.push(child)
        return child
      },
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('deep-reading'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const events = await collect(submission.events)
    const terminal = terminalOf(events)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('failed')
      expect(terminal.branches).toEqual({ translation: 'not-selected', 'deep-reading': 'failed' })
    }
    await waitForExit(spawned[0]!)
    expect(spawned[0]!.exitCode).toBe(3)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
  })

  it('marks a clean child exit failed when it emits no readable preview', async () => {
    const root = tempRoot()
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath) => spawn(nodePath, ['-e', 'process.exit(0)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }

    const terminal = terminalOf(await collect(submission.events))
    expect(terminal).toMatchObject({
      type: 'terminal',
      outcome: 'failed',
      branches: { translation: 'failed', 'deep-reading': 'not-selected' },
      cleanup: 'clean',
    })
  })

  it('stops a running child on cancel and retains the finished sibling', async () => {
    const root = tempRoot()
    const spawned: ChildProcess[] = []
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath, _args, home) => {
        const script = home.includes('deep-reading')
          ? 'setInterval(() => {}, 1000)'
          : `${workerScriptEventLine({ type: 'preview', paragraphs: ['已完成样例'] })}\nprocess.exit(0)`
        const child = spawn(nodePath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        spawned.push(child)
        return child
      },
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('both'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const collected: PaperTaskEvent[] = []
    const done = (async () => {
      for await (const event of submission.events) {
        collected.push(event)
      }
    })()
    // The translation child exits 0; the runner records sample-ready, then
    // closes and removes its runtime home. Wait for the exit and then the home
    // removal so the finished sibling is retained deterministically.
    await waitFor(() => spawned.some((child) => child.exitCode === 0))
    const translationHome = join(root, 'runtime-local', TASK_ID, 'translation')
    await waitFor(() => existsSync(translationHome) === false)
    const cancelResult = await svc.cancel(TASK_ID)
    expect(cancelResult).toEqual({ ok: true, code: 'stopped' })
    await done
    const terminal = terminalOf(collected)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('cancelled')
      expect(terminal.branches).toEqual({ translation: 'sample-ready', 'deep-reading': 'cancelled' })
    }
    expect(spawned).toHaveLength(2)
    for (const child of spawned) {
      await waitForExit(child)
    }
    expect(spawned.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
  })
})

describe('paper-task lifecycle — real socket disconnect', () => {
  it('emits a disconnected terminal and stops the running child when the socket dies', async () => {
    const root = tempRoot()
    const spawned: ChildProcess[] = []
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath) => {
        const child = spawn(nodePath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        spawned.push(child)
        return child
      },
    })
    const svc = makeService(factory, root)

    const streamEvents: PaperTaskEvent[] = []
    const requestHandled = deferred()
    const streamCompleted = deferred()
    let server: Server | undefined
    servers.push(createServer((req, res) => {
      requestHandled.resolve()
      const disconnect = observeRequestDisconnect(req, res)
      req.resume()
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': connected\n\n')
      void (async () => {
        try {
          const submission = await svc.submit(input('both'), { signal: disconnect.signal })
          if (submission.ok) {
            for await (const event of submission.events) {
              streamEvents.push(event)
              if (!disconnect.signal.aborted) {
                res.write(`data: ${JSON.stringify(event)}\n\n`)
              }
            }
          }
        } finally {
          disconnect.dispose()
          res.end()
          streamCompleted.resolve()
        }
      })()
    }))

    await new Promise<void>((resolve) => servers[0]!.listen(0, '127.0.0.1', resolve))
    const address = servers[0]!.address()
    if (address === null || typeof address === 'string') {
      throw new Error('test server did not bind')
    }
    const socket = connect(address.port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello')
    await requestHandled.promise
    await waitFor(() => spawned.length > 0)
    socket.destroy()
    await streamCompleted.promise

    const terminal = terminalOf(streamEvents)
    if (terminal.type === 'terminal') {
      expect(terminal.outcome).toBe('disconnected')
      expect(terminal.branches).toEqual({ translation: 'cancelled', 'deep-reading': 'cancelled' })
    }
    for (const child of spawned) {
      await waitForExit(child)
    }
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
    expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
  })
})

describe('paper-task lifecycle — deletion and blocked cleanup', () => {
  it('settles cancel and blocks deletion when the child ignores both bounded kills', async () => {
    const root = tempRoot()
    let child: ChildProcess | undefined
    let restoreKill: (() => void) | undefined
    let runtime: PaperTaskRuntime | undefined
    let childClosed: Promise<void> | undefined
    const processFactory = createSampleProcessRuntimeFactory({
      killGraceMs: 5,
      spawnChild: (nodePath) => {
        child = spawn(nodePath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        const ownedChild = child
        const originalKill = ownedChild.kill.bind(ownedChild)
        ownedChild.kill = () => true
        restoreKill = () => { ownedChild.kill = originalKill }
        childClosed = new Promise((resolve) => ownedChild.once('close', () => resolve()))
        return ownedChild
      },
    })
    const factory = (options: Parameters<typeof processFactory>[0]): PaperTaskRuntime => {
      runtime = processFactory(options)
      return runtime
    }
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const collected: PaperTaskEvent[] = []
    const done = collect(submission.events).then((events) => collected.push(...events))

    try {
      await waitFor(() => child !== undefined)
      const cancellation = svc.cancel(TASK_ID)
      let cancelTimer: ReturnType<typeof setTimeout> | undefined
      const cancelResult = await Promise.race([
        cancellation,
        new Promise<never>((_, reject) => {
          cancelTimer = setTimeout(() => reject(new Error('cancel did not settle')), 3000)
        }),
      ])
      if (cancelTimer !== undefined) {
        clearTimeout(cancelTimer)
      }
      expect(cancelResult).toEqual({ ok: false, code: 'cleanup-failed' })
      await done
      expect(terminalOf(collected)).toMatchObject({
        type: 'terminal',
        outcome: 'cancelled',
        branches: { translation: 'cancelled', 'deep-reading': 'not-selected' },
        cleanup: 'failed',
      })
      expect(await svc.remove(TASK_ID)).toEqual({ ok: false, code: 'cleanup-failed' })
      expect(existsSync(join(root, 'project-local', TASK_ID, 'original.pdf'))).toBe(true)
      expect(existsSync(join(root, 'project-local', TASK_ID, 'work-context.json'))).toBe(true)
      expect(existsSync(join(root, 'runtime-local', TASK_ID, 'translation'))).toBe(true)
    } finally {
      restoreKill?.()
      child?.kill('SIGKILL')
      await childClosed
      await runtime?.close()
    }
  })

  it('deletes an active task after stopping its child and awaiting cleanup', async () => {
    const root = tempRoot()
    const spawned: ChildProcess[] = []
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath) => {
        const child = spawn(nodePath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        spawned.push(child)
        return child
      },
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    const done = (async () => {
      for await (const _event of submission.events) {
        // drain the stream while the task is active
      }
    })()
    await waitFor(() => spawned.length > 0)
    const removeResult = await svc.remove(TASK_ID)
    expect(removeResult).toEqual({ ok: true, code: 'deleted' })
    await done
    await waitForExit(spawned[0]!)
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(false)
    expect(existsSync(join(root, 'runtime-local', TASK_ID))).toBe(false)
  })

  it('blocks deletion when runtime cleanup fails and retains the workspace', async () => {
    const root = tempRoot()
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath) => {
        const child = spawn(nodePath, ['-e', 'process.exit(0)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        return child
      },
      removeRuntimeHome: () => {
        throw new Error('cleanup failure')
      },
    })
    const svc = makeService(factory, root)
    const submission = await svc.submit(input('translation'))
    if (!submission.ok) {
      throw new Error('submit failed')
    }
    await collect(submission.events)
    expect(await svc.remove(TASK_ID)).toEqual({ ok: false, code: 'cleanup-failed' })
    expect(existsSync(join(root, 'project-local', TASK_ID))).toBe(true)
  })
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
