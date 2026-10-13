import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import type { PaperTaskStage } from '../../app/utils/paper-task-contract'
import type { PaperTaskBranchResult, PaperTaskCloseResult, PaperTaskRuntime, PaperTaskRuntimeEvent, PaperTaskRuntimeOptions } from './runtime'
import { verifyPinnedDsh } from './dsh-pin'

export interface DshRuntimeContext {
  readonly provider: PaperTaskProviderSettings
  readonly workspaceRoot: string
  readonly taskInputPath: string
  readonly resourcesRoot: string
}

export function createDshRuntimeFactory(context: DshRuntimeContext): (options: PaperTaskRuntimeOptions) => PaperTaskRuntime {
  const dshBin = verifyPinnedDsh()
  return (options) => {
    try {
      return new DshPaperTaskRuntime(options, context, dshBin)
    } catch (error) {
      rmSync(options.runtimeHome, { recursive: true, force: true })
      throw error
    }
  }
}

class DshPaperTaskRuntime implements PaperTaskRuntime {
  readonly result: Promise<PaperTaskBranchResult>
  private readonly harness: DeepSeekHarness
  private readonly home: string
  private readonly branchRoot: string
  private readonly branch: PaperTaskRuntimeOptions['branch']
  private readonly eventsPromise: Promise<readonly PaperTaskRuntimeEvent[]>
  private closePromise: Promise<PaperTaskCloseResult> | undefined

  constructor(options: PaperTaskRuntimeOptions, context: DshRuntimeContext, dshBin: string) {
    mkdirSync(options.runtimeHome, { recursive: true })
    const runtimeHome = resolve(options.runtimeHome)
    this.home = runtimeHome
    if (options.branchWorkspaceDir === undefined) throw new Error('paper task branch workspace is unavailable')
    this.branchRoot = resolve(options.branchWorkspaceDir)
    this.branch = options.branch
    const pluginPath = resolve(process.cwd(), 'server', 'paper-task', 'controlled-tools.mjs')
    const providerConfig = JSON.stringify({
      providers: {
        'paper-task-provider': {
          displayName: context.provider.providerLabel,
          api: context.provider.protocol,
          baseURL: context.provider.baseUrl,
          apiKeyEnv: 'PAPER_TASK_MODEL_API_KEY',
          defaultMaxTokens: 8192,
          models: [{ id: context.provider.model }],
          retryPolicy: { mode: 'normal', maxRetries: 0 },
        },
      },
    })
    const patchPath = join(runtimeHome, 'paper-task.cordis.patch.yml')
    writeFileSync(patchPath, [
      '- insert:',
      '    - id: llm-pi-ai',
      "      name: '@deepseek-ai/dsh-llm-pi-ai'",
      '      inject: [llm]',
      `      config: !!js "JSON.parse(process.env.PAPER_TASK_PROVIDER_CONFIGURATION)"`,
      '    - id: paper-task-controlled-tools',
      `      name: ${JSON.stringify(pluginPath)}`,
      '      inject: [tools]',
      '- id: persistent-bash',
      '  disabled: true',
      '- id: persistent-pwsh',
      '  disabled: true',
      '- id: llm-retry',
      '  disabled: true',
      '- id: mcp-resources',
      '  disabled: true',
      '',
    ].join('\n'), { flag: 'wx', mode: 0o600 })
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PAPER_TASK_PROVIDER_CONFIGURATION: providerConfig,
      PAPER_TASK_WORKSPACE: context.workspaceRoot,
      PAPER_TASK_SOURCE_ROOT: join(context.workspaceRoot, 'source-records'),
      PAPER_TASK_RESOURCE_ROOT: context.resourcesRoot,
      PAPER_TASK_INPUT: context.taskInputPath,
      PAPER_TASK_BRANCH_ROOT: options.branchWorkspaceDir ?? '',
      PAPER_TASK_BRANCH: options.branch,
      PAPER_TASK_MODEL_API_KEY: context.provider.apiKey || 'paper-task-no-auth',
    }
    this.harness = new DeepSeekHarness({
      profile: 'sdk-minimal',
      dshBin,
      dshHome: join(runtimeHome, 'harness-home'),
      processCwd: context.workspaceRoot,
      cwd: context.workspaceRoot,
      provider: 'paper-task-provider',
      model: context.provider.model,
      patches: [patchPath],
      env,
      initializeTimeoutMs: 15000,
      requestTimeoutMs: 120000,
      shutdownTimeoutMs: 3000,
      disposeEofGraceMs: 1500,
      disposeGraceMs: 2000,
    })
    this.eventsPromise = this.run(options.signal)
    this.result = this.eventsPromise.then(async (events) => {
      const hasPreview = events.some((event) => event.type === 'generated-preview')
      const closed = await this.close()
      return { ok: hasPreview && closed.ok }
    })
  }

  async *events(): AsyncGenerator<PaperTaskRuntimeEvent> {
    yield { type: 'progress', stage: 'generating', completed: 0, total: 1 }
    const events = await this.eventsPromise
    yield* events.slice(1)
  }

  close(): Promise<PaperTaskCloseResult> {
    this.closePromise ??= this.dispose()
    return this.closePromise
  }

  private async run(signal?: AbortSignal): Promise<readonly PaperTaskRuntimeEvent[]> {
    const events: PaperTaskRuntimeEvent[] = [{ type: 'progress', stage: 'generating' satisfies PaperTaskStage, completed: 0, total: 1 }]
    let removeAbortListener = (): void => undefined
    const aborted = new Promise<undefined>((resolveAbort) => {
      if (signal === undefined) return
      const abort = (): void => {
        void this.close()
        resolveAbort(undefined)
      }
      if (signal.aborted) abort()
      else {
        signal.addEventListener('abort', abort, { once: true })
        removeAbortListener = () => signal.removeEventListener('abort', abort)
      }
    })
    const runTimer = setTimeout(() => { void this.close() }, 180000)
    try {
      if (signal?.aborted) return []
      const prompt = `You are generating only the ${this.branch} branch. Call paper_task_read_input with no arguments first. Read the complete pinned branch SKILL.md, then the original source records and required references with the supplied tools. Continue paged reads at nextOffset until totalBytes. Save an unfinished natural Markdown preview with paper_task_write_branch and the identifiers of every source record read. Do not call any other tools.`
      const run = this.harness.run(prompt)
      const outcome = await Promise.race([run, aborted])
      if (outcome === undefined || signal?.aborted) return []
      const markdown = readFileSync(join(this.branchRoot, 'preview.md'), 'utf8')
      if (!hasSuccessfulBranchWrite(outcome, markdown)) return []
      const paragraphs = markdown.split(/\n\s*\n/).map((part) => part.trim())
        .filter((part) => part.length > 0).slice(0, 8).map((part) => part.slice(0, 2000))
      if (paragraphs.length === 0) throw new Error('paper task produced no bounded preview paragraphs')
      events.push({ type: 'generated-preview', markdown, paragraphs })
      events.push({ type: 'progress', stage: 'generating', completed: 1, total: 1 })
      return events
    } catch {
      return []
    } finally {
      clearTimeout(runTimer)
      removeAbortListener()
      await this.close()
    }
  }

  private async dispose(): Promise<PaperTaskCloseResult> {
    try {
      await this.harness.close()
      rmSync(this.home, { recursive: true, force: true })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

}

function hasSuccessfulBranchWrite(result: RunResult, markdown: string): boolean {
  const writes = result.events.filter((event): event is Extract<RunResult['events'][number], { type: 'tool/call' }> => event.type === 'tool/call'
    && event.data.name === 'paper_task_write_branch')
  return writes.some((call) => {
    let rawArguments: unknown
    try {
      rawArguments = JSON.parse(call.data.arguments)
    } catch {
      return false
    }
    const argumentsResult = z.object({ markdown: z.string().min(1) }).safeParse(rawArguments)
    return argumentsResult.success && argumentsResult.data.markdown === markdown
      && result.events.some((event) => event.type === 'tool/result'
        && event.data.message.toolCallId === call.data.callId
        && event.data.message.isError !== true)
  })
}
