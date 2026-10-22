/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createSampleProcessRuntimeFactory } from '../../server/paper-task/runtime'

const roots: string[] = []
const originalTestSecret = process.env.PAPER_TASK_TEST_SECRET

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  if (originalTestSecret === undefined) {
    delete process.env.PAPER_TASK_TEST_SECRET
  } else {
    process.env.PAPER_TASK_TEST_SECRET = originalTestSecret
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paper-task-runtime-'))
  roots.push(root)
  return root
}

function options(runtimeHome: string, workContextPath: string) {
  return { branch: 'translation' as const, runtimeHome, workContextPath }
}

describe('paper-task process runtime', () => {
  it('uses the local sample worker and forwards only approved environment keys', async () => {
    const root = tempRoot()
    const runtimeHome = join(root, 'home')
    const workContextPath = join(root, 'context.json')
    const sourceRecordsDir = join(root, 'source-records')
    mkdirSync(sourceRecordsDir)
    writeFileSync(join(sourceRecordsDir, 'p1-r0.json'), JSON.stringify({
      revision: 1,
      record: { id: 'p1-r0', order: 0, kind: 'body', text: 'A sample source.', state: 'present', sectionId: null, context: '' },
    }))
    writeFileSync(workContextPath, JSON.stringify({ sourceRecordsDir }))
    process.env.PAPER_TASK_TEST_SECRET = 'must-not-reach-child'
    let seenArgs: readonly string[] = []
    let seenEnv: NodeJS.ProcessEnv = {}
    let seenChild: ChildProcess | undefined
    const runtime = createSampleProcessRuntimeFactory({
      spawnChild: (nodePath, args, home, env) => {
        seenArgs = args
        seenEnv = env
        seenChild = spawn(nodePath, args, { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
        return seenChild
      },
    })({ ...options(runtimeHome, workContextPath), sourceReadPaths: [sourceRecordsDir] })

    const events = []
    for await (const event of runtime.events()) {
      events.push(event)
    }

    expect(await runtime.result).toEqual({ ok: true })
    const workerPath = resolve(process.cwd(), 'server', 'paper-task', 'sample-worker.mjs')
    expect(seenArgs).toContain(workerPath)
    expect(seenEnv.PAPER_TASK_TEST_SECRET).toBeUndefined()
    expect(Object.keys(seenEnv).every((key) => ['PATH', 'SystemRoot', 'TEMP', 'TMP'].includes(key))).toBe(true)
    expect(events.some((event) => event.type === 'preview')).toBe(true)
    expect(seenChild?.spawnargs).toContain(workerPath)
    expect(await runtime.close()).toEqual({ ok: true })
    expect(existsSync(runtimeHome)).toBe(false)
  })

  it('removes the runtime home when child creation throws', () => {
    const runtimeHome = join(tempRoot(), 'home')
    const factory = createSampleProcessRuntimeFactory({
      spawnChild: () => { throw new Error('spawn failed') },
    })

    expect(() => factory(options(runtimeHome, 'unused'))).toThrow('spawn failed')
    expect(existsSync(runtimeHome)).toBe(false)
  })

  it('settles an operating-system spawn error and cleans the runtime home', async () => {
    const runtimeHome = join(tempRoot(), 'home')
    const runtime = createSampleProcessRuntimeFactory({ nodePath: join(runtimeHome, 'missing-node') })(
      options(runtimeHome, 'unused'),
    )

    expect(await runtime.result).toEqual({ ok: false })
    expect(await runtime.close()).toEqual({ ok: true })
    expect(existsSync(runtimeHome)).toBe(false)
  })

  it('reports cleanup failure and retains the home when the child stays open', async () => {
    const runtimeHome = join(tempRoot(), 'home')
    let stopChild = (): void => undefined
    let childClosed = Promise.resolve()
    const runtime = createSampleProcessRuntimeFactory({
      killGraceMs: 5,
      spawnChild: () => {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
        const killChild = child.kill.bind(child)
        child.kill = () => true
        childClosed = new Promise((resolve) => child.once('close', resolve))
        stopChild = () => {
          child.kill = killChild
          child.kill('SIGKILL')
        }
        return child
      },
    })(options(runtimeHome, 'unused'))

    try {
      expect(await runtime.close()).toEqual({ ok: false })
      expect(existsSync(runtimeHome)).toBe(true)
    } finally {
      stopChild()
      await childClosed
    }
  })
})
