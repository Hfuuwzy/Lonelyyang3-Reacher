/**
 * Branch runtime for a sample-only paper task (issue #40).
 *
 * Each selected branch gets its own ephemeral runtime home and one owned local
 * child process (the sample worker). `events` streams the worker's stdout as
 * typed runtime events, `result` resolves with the branch outcome when the
 * process exits, and `close` stops the process and removes the ephemeral home.
 * The runtime factory is the injectable seam that lets tests prove the real
 * process lifecycle (success, failure, cancel, disconnect).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { workerPreviewSchema, type PaperTaskWorkerPreview } from './source-pieces'
import {
  paperTaskStageSchema,
  type PaperTaskBranch,
  type PaperTaskStage,
} from '../../app/utils/paper-task-contract'

export type PaperTaskRuntimeEvent =
  | { readonly type: 'progress'; readonly stage: PaperTaskStage; readonly completed: number; readonly total: number }
  | PaperTaskWorkerPreview

export type PaperTaskBranchResult = { readonly ok: true } | { readonly ok: false }
export type PaperTaskCloseResult = { readonly ok: true } | { readonly ok: false }

export interface PaperTaskRuntime {
  /** Stream the owned process's events; completes when the process exits. */
  readonly events: () => AsyncIterable<PaperTaskRuntimeEvent>
  /** Resolves once the owned process exits, ok when it exited 0. */
  readonly result: Promise<PaperTaskBranchResult>
  /** Stop the process if alive and remove the ephemeral runtime home. */
  readonly close: () => Promise<PaperTaskCloseResult>
}

export interface PaperTaskRuntimeOptions {
  readonly branch: PaperTaskBranch
  readonly workContextPath: string
  /** Exact prepared source files or directories the worker may read. */
  readonly sourceReadPaths?: readonly string[]
  /** Precreated retained branch workspace; writable by this worker only. */
  readonly branchWorkspaceDir?: string
  /** Ephemeral per-branch home; removed by `close`. */
  readonly runtimeHome: string
  /** Aborting kills the owned process; `close` still must be called. */
  readonly signal?: AbortSignal
}

export type PaperTaskRuntimeFactory = (options: PaperTaskRuntimeOptions) => PaperTaskRuntime

export interface SampleProcessRuntimeDependencies {
  readonly nodePath?: string
  readonly workerPath?: string
  readonly spawnChild?: (nodePath: string, args: readonly string[], home: string, env: NodeJS.ProcessEnv) => ChildProcess
  readonly removeRuntimeHome?: (home: string) => void
  readonly killGraceMs?: number
}

const runtimeProgressSchema = z.object({
  type: z.literal('progress'),
  stage: paperTaskStageSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
}).passthrough()

const runtimeEventSchema = z.discriminatedUnion('type', [
  runtimeProgressSchema,
  workerPreviewSchema,
])

/** Max bytes on a single runtime event line, so a bad child cannot exhaust memory. */
const MAX_EVENT_LINE_LENGTH = 64 * 1024

class SampleProcessRuntime implements PaperTaskRuntime {
  readonly result: Promise<PaperTaskBranchResult>
  private readonly home: string
  private readonly child: ChildProcess
  private readonly removeHome: (home: string) => void
  private readonly killGraceMs: number
  private closePromise: Promise<PaperTaskCloseResult> | undefined
  private processClosed = false

  constructor(options: PaperTaskRuntimeOptions, deps: SampleProcessRuntimeDependencies) {
    this.home = options.runtimeHome
    this.removeHome = deps.removeRuntimeHome ?? defaultRemoveRuntimeHome
    this.killGraceMs = deps.killGraceMs ?? 1000
    mkdirSync(options.runtimeHome, { recursive: true })

    const nodePath = deps.nodePath ?? process.execPath
    const workerPath = resolve(deps.workerPath ?? DEFAULT_WORKER_PATH)
    const args = [
      '--permission',
      `--allow-fs-read=${resolve(options.workContextPath)}`,
      `--allow-fs-read=${workerPath}`,
      ...(options.sourceReadPaths ?? []).map((path) => `--allow-fs-read=${resolve(path)}`),
      ...(options.branchWorkspaceDir === undefined ? [] : [`--allow-fs-read=${resolve(options.branchWorkspaceDir)}`]),
      ...(options.branchWorkspaceDir === undefined ? [] : [`--allow-fs-write=${resolve(options.branchWorkspaceDir)}`]),
      workerPath,
      resolve(options.workContextPath),
      options.branch,
    ]
    const env: NodeJS.ProcessEnv = {}
    for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP']) {
      const value = process.env[key]
      if (value !== undefined) {
        env[key] = value
      }
    }
    try {
      this.child = deps.spawnChild?.(nodePath, args, this.home, env) ?? spawn(
        nodePath,
        args,
        { cwd: this.home, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env },
      )
    } catch (error) {
      this.removeHome(this.home)
      throw error
    }

    this.result = new Promise((resolve) => {
      const onError = (): void => undefined
      const settle = (): void => {
        this.processClosed = true
        this.child.off('close', settle)
        this.child.off('error', onError)
        resolve({ ok: this.child.exitCode === 0 })
      }
      this.child.on('close', settle)
      this.child.on('error', onError)
    })

    const signal = options.signal
    if (signal?.aborted) {
      this.releaseProcessStreams()
      this.killProcess()
    } else {
      const abort = (): void => {
        this.releaseProcessStreams()
        this.killProcess()
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.child.once('close', () => signal?.removeEventListener('abort', abort))
    }
  }

  async *events(): AsyncGenerator<PaperTaskRuntimeEvent> {
    const stdout = this.child.stdout
    if (stdout === null) {
      throw new Error('paper task runtime child stdout unavailable')
    }
    const lines = createInterface({ input: stdout, crlfDelay: Infinity })
    for await (const line of lines) {
      if (line.length > MAX_EVENT_LINE_LENGTH) {
        void this.close()
        throw new Error('paper task runtime event line too long')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new Error('paper task runtime event is not valid JSON')
      }
      const event = runtimeEventSchema.safeParse(parsed)
      if (!event.success) {
        throw new Error('paper task runtime event is not a supported event')
      }
      yield event.data
    }
  }

  close(): Promise<PaperTaskCloseResult> {
    this.closePromise ??= this.doClose()
    return this.closePromise
  }

  private async doClose(): Promise<PaperTaskCloseResult> {
    try {
      await this.reapProcess()
      this.removeHome(this.home)
      return { ok: true }
    } catch {
      return { ok: false }
    } finally {
      this.releaseProcessStreams()
    }
  }

  private releaseProcessStreams(): void {
    this.child.stdout?.destroy()
    this.child.stderr?.destroy()
  }

  private async reapProcess(): Promise<void> {
    if (this.processClosed) {
      return
    }
    this.killProcess()
    await this.waitForClose(this.killGraceMs)
    if (!this.processClosed) {
      this.child.kill('SIGKILL')
      await this.waitForClose(this.killGraceMs)
    }
    if (!this.processClosed) {
      throw new Error('paper task runtime child did not close')
    }
  }

  private waitForClose(timeoutMs: number): Promise<void> {
    if (this.processClosed) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.off('close', onClose)
        resolve()
      }, timeoutMs)
      const onClose = (): void => {
        clearTimeout(timer)
        this.child.off('close', onClose)
        resolve()
      }
      this.child.once('close', onClose)
    })
  }

  private killProcess(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM')
    }
  }
}

function defaultRemoveRuntimeHome(home: string): void {
  rmSync(home, { recursive: true, force: true })
}

const DEFAULT_WORKER_PATH = resolve(process.cwd(), 'server', 'paper-task', 'sample-worker.mjs')

/** Default factory: one real `node sample-worker.mjs` child per branch. */
export function createSampleProcessRuntimeFactory(
  deps: SampleProcessRuntimeDependencies = {},
): PaperTaskRuntimeFactory {
  return (options) => new SampleProcessRuntime(options, deps)
}
