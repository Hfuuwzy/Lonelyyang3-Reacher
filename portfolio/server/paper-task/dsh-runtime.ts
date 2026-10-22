import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-client'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { IMAGE_LIMITS, type PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import { PAPER_TASK_QUALITY_LIMITS, type PaperTaskStage } from '../../app/utils/paper-task-contract'
import type { PaperTaskBranchResult, PaperTaskCloseResult, PaperTaskRuntime, PaperTaskRuntimeEvent, PaperTaskRuntimeOptions } from './runtime'
import { verifyPinnedDsh } from './dsh-pin'
import { preparePaperTaskImages, type PreparedPaperTaskImage } from './image-input'
import { startPaperTaskImageGuard } from './image-request-guard'
import { savePaperTaskImageReceipts } from './image-receipts'
import { evaluateBranchQuality } from './branch-quality'
import { hasSuccessfulBranchWrite, translationMasterMatches } from './branch-output'
import { paperTaskGenerationPrompt, paperTaskRecoveryPrompt } from './generation-prompt'
import { clean, diagnoseEvents, diagnoseRun, failedWriteFailure, hasFailedWrite, isCompletedRun, safeDiagnosticEvent, terminalRunFailure, type DshRunDiagnostics } from './dsh-outcome'

/**
 * A whole-paper task reads every indexed record before writing, so the old
 * five-minute wall clock cut long papers off mid-generation. The limit remains
 * configurable for operators who need a tighter bound.
 */
const DEFAULT_RUN_LIMIT_MS = 60 * 60_000
/** Whole-paper translation and deep reading need more than the old 8k output cap. */
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768
const MAX_OBSERVED_DIAGNOSTIC_EVENTS = 64

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

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
  private harness: DeepSeekHarness | undefined
  private guard: Awaited<ReturnType<typeof startPaperTaskImageGuard>> | undefined
  private initializationPromise: Promise<boolean> | undefined
  private closing = false
  private receiptPersistenceFailed = false
  private timedOut = false
  private failureRecorded = false
  private diagnostics: DshRunDiagnostics[] = []
  private observedEvents: unknown[] = []
  private observedSessionId: string | undefined
  private preparedImages: readonly PreparedPaperTaskImage[] = []
  private readonly options: PaperTaskRuntimeOptions
  private readonly context: DshRuntimeContext
  private readonly dshBin: string
  private readonly home: string
  private readonly branchRoot: string
  private readonly branch: PaperTaskRuntimeOptions['branch']
  private readonly eventsPromise: Promise<readonly PaperTaskRuntimeEvent[]>
  private closePromise: Promise<PaperTaskCloseResult> | undefined

  constructor(options: PaperTaskRuntimeOptions, context: DshRuntimeContext, dshBin: string) {
    mkdirSync(options.runtimeHome, { recursive: true })
    const runtimeHome = resolve(options.runtimeHome)
    this.home = runtimeHome
    this.options = options
    this.context = context
    this.dshBin = dshBin
    if (options.branchWorkspaceDir === undefined) throw new Error('paper task branch workspace is unavailable')
    this.branchRoot = resolve(options.branchWorkspaceDir)
    this.branch = options.branch
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
    let stage: DshRunDiagnostics['stage'] = 'primary'
    let interruption: DshRunDiagnostics['interrupted']
    this.observedEvents = []
    this.observedSessionId = undefined
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
    const runTimer = setTimeout(() => {
      this.timedOut = true
      this.recordFailure(new Error('paper task runtime exceeded its time limit'))
      void this.close()
    }, positiveIntegerEnv('PAPER_TASK_RUN_LIMIT_MS', DEFAULT_RUN_LIMIT_MS))
    try {
      if (signal?.aborted || this.timedOut) {
        interruption = signal?.aborted ? 'aborted' : 'timeout'
        return []
      }
      this.initializationPromise = this.initialize(signal)
      const initialized = await this.initializationPromise
      if (signal?.aborted || this.timedOut) {
        interruption = signal?.aborted ? 'aborted' : 'timeout'
        return []
      }
      if (!initialized) return []
      const prompt = paperTaskGenerationPrompt(this.branch)
      const promptBlocks: SdkPromptContentBlock[] = [{ type: 'text', text: prompt }]
      for (const image of this.preparedImages) {
        promptBlocks.push({ type: 'text', text: image.context })
        promptBlocks.push({ type: 'image', data: image.data, mimeType: 'image/png' })
      }
      const harness = this.harness
      if (harness === undefined) return []
      const observe = (notification: { readonly params: Record<string, unknown> }): void => {
        if (typeof notification.params.sessionId === 'string') this.observedSessionId = notification.params.sessionId
        const event = safeDiagnosticEvent(notification.params.event, this.context.provider.apiKey)
        if (event !== undefined && this.observedEvents.length < MAX_OBSERVED_DIAGNOSTIC_EVENTS) this.observedEvents.push(event)
      }
      let run = harness.run(promptBlocks, { onNotification: observe })
      let outcome = await Promise.race([run, aborted])
      if (outcome === undefined || signal?.aborted || this.timedOut) {
        interruption = signal?.aborted ? 'aborted' : 'timeout'
        return []
      }
      const primaryFailure = terminalRunFailure(outcome)
      this.diagnostics.push(diagnoseRun(outcome, 'primary', this.context.provider.apiKey))
      this.persistDiagnostics()
      if (primaryFailure !== undefined) {
        this.recordFailure(new Error(primaryFailure))
        return []
      }
      if (this.receiptPersistenceFailed) return []
      const markdownPath = this.branch === 'translation'
        ? join(this.branchRoot, 'master.md')
        : join(this.branchRoot, 'report.md')
      const writeFailure = failedWriteFailure(outcome)
      const incompleteCoverage = /read the complete source\.md|read the complete selected SKILL\.md/u.test(writeFailure ?? '')
      if (!existsSync(markdownPath) && hasFailedWrite(outcome) && !incompleteCoverage) {
        this.recordFailure(new Error(failedWriteFailure(outcome) ?? 'paper_task_write_branch failed'))
        return []
      }
      if (!existsSync(markdownPath) && !this.timedOut && !signal?.aborted && isCompletedRun(outcome)) {
        const recovery = paperTaskRecoveryPrompt(this.branch)
        const primary = outcome
        this.observedEvents = []
        this.observedSessionId = primary.sessionId
        stage = 'recovery'
        const recoveryRun = harness.run([{ type: 'text', text: recovery }], { sessionId: primary.sessionId, onNotification: observe })
        outcome = await Promise.race([recoveryRun, aborted])
        if (outcome === undefined || signal?.aborted || this.timedOut) {
          interruption = signal?.aborted ? 'aborted' : 'timeout'
          return []
        }
        this.diagnostics.push(diagnoseRun(outcome, 'recovery', this.context.provider.apiKey))
        this.persistDiagnostics()
        if (terminalRunFailure(outcome) !== undefined) {
          this.recordFailure(new Error(terminalRunFailure(outcome)))
          return []
        }
        if (this.receiptPersistenceFailed) return []
      }
      if (!existsSync(markdownPath)) {
        if (hasFailedWrite(outcome)) {
          this.recordFailure(new Error(failedWriteFailure(outcome) ?? 'paper_task_write_branch failed'))
          return []
        }
        const output = basename(markdownPath)
        const finalResponse = boundedFinalResponse(outcome)
        this.recordFailure(new Error(`${this.branch} branch produced no ${output}; model final response: ${finalResponse}`))
        return []
      }
      const markdown = readFileSync(markdownPath, 'utf8')
      if (this.branch === 'translation') {
        if (!translationMasterMatches(this.branchRoot, markdown)) {
          this.recordFailure(new Error('translation master and preview do not match'))
          return []
        }
      } else if (readFileSync(join(this.branchRoot, 'preview.md'), 'utf8') !== markdown) {
        this.recordFailure(new Error('deep-reading report and preview do not match'))
        return []
      }
      if (!hasSuccessfulBranchWrite(outcome, markdown, this.branch, this.branchRoot)) {
        if (hasFailedWrite(outcome)) {
          this.recordFailure(new Error(failedWriteFailure(outcome) ?? 'paper_task_write_branch failed'))
          return []
        }
        this.recordFailure(new Error('paper_task_write_branch did not publish the final bytes'))
        return []
      }
      const quality = evaluateBranchQuality(this.context.workspaceRoot, this.branch)
      if (quality.status === 'failed') {
        this.recordFailure(new Error(`branch quality failed: ${quality.issues.map((issue) => issue.code).join(', ')}`))
        return []
      }
      const paragraphs = markdown.split(/\n\s*\n/).map((part) => part.trim())
        .filter((part) => part.length > 0).slice(0, 8).map((part) => part.slice(0, 2000))
      if (paragraphs.length === 0) throw new Error('paper task produced no bounded preview paragraphs')
      events.push({
        type: 'generated-preview', markdown, paragraphs,
        quality: {
          status: quality.status,
          issues: quality.issues.map((issue) => issue.message).slice(0, PAPER_TASK_QUALITY_LIMITS.maxIssues),
          options: [...quality.options],
        },
      })
      events.push({ type: 'progress', stage: 'generating', completed: 1, total: 1 })
      return events
    } catch (error) {
      if (this.timedOut || signal?.aborted) {
        interruption = signal?.aborted ? 'aborted' : 'timeout'
      } else {
        this.diagnostics.push({
          ...diagnoseEvents(this.observedEvents, stage, this.context.provider.apiKey, this.observedSessionId),
          runRejected: true,
          rejectedMessage: clean(error instanceof Error ? error.message : String(error), this.context.provider.apiKey),
        })
        this.persistDiagnostics()
        this.recordFailure(error)
      }
      return []
    } finally {
      clearTimeout(runTimer)
      removeAbortListener()
      if (interruption !== undefined) {
        this.diagnostics.push({
          ...diagnoseEvents(this.observedEvents, stage, this.context.provider.apiKey, this.observedSessionId),
          interrupted: interruption,
        })
        this.persistDiagnostics()
      }
      await this.close()
    }
  }

  private recordFailure(error: unknown): void {
    if (this.failureRecorded) return
    this.failureRecorded = true
    const apiKey = this.context.provider.apiKey
    const name = clean(error instanceof Error ? error.name : 'Error', apiKey)
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = clean(rawMessage, apiKey)
    const record = { at: new Date().toISOString(), branch: this.branch, timedOut: this.timedOut, name, message }
    try {
      writeFileSync(join(this.branchRoot, 'runtime-error.json'), JSON.stringify(record), { flag: 'w' })
    } catch {
      // Diagnostics are best effort; a retained branch may already be gone.
    }
    console.error(`[paper-task] ${this.branch} runtime failed: ${name}: ${message}`)
  }

  private persistDiagnostics(): void {
    try {
      writeFileSync(join(this.branchRoot, 'runtime-diagnostics.json'), JSON.stringify({ version: 1, branch: this.branch, timedOut: this.timedOut, runs: this.diagnostics }), { flag: 'w' })
    } catch {
      return
    }
  }

  private async dispose(): Promise<PaperTaskCloseResult> {
    this.closing = true
    let succeeded = true
    if (this.initializationPromise !== undefined) {
      await this.initializationPromise.then(() => undefined, () => undefined)
    }
    let harnessClosed = true
    try {
      if (this.harness !== undefined) await this.harness.close()
    } catch {
      succeeded = false
      harnessClosed = false
    }
    try {
      if (this.guard !== undefined) await this.guard.close()
    } catch {
      succeeded = false
    }
    if (harnessClosed) {
      try {
        rmSync(this.home, { recursive: true, force: true })
      } catch {
        succeeded = false
      }
    }
    return { ok: succeeded }
  }

  private async initialize(
    signal?: AbortSignal,
  ): Promise<boolean> {
    const { context, options, dshBin } = this
    const prepared = await preparePaperTaskImages(context.workspaceRoot, this.branch, context.provider.imageInput)
    savePaperTaskImageReceipts(context.workspaceRoot, this.branch, prepared.receipts)
    if (this.closing || signal?.aborted) return false
    this.preparedImages = prepared.images
    const receipts = new Map(prepared.receipts.map(receipt => [receipt.assetId, receipt]))
    const guard = await startPaperTaskImageGuard({
      provider: context.provider,
      images: prepared.images,
      ...(signal === undefined ? {} : { signal }),
      onReceipt: (assetId, status, reason) => {
        const existing = receipts.get(assetId)
        if (existing === undefined) return
        const next: PaperTaskImageReceipt = { ...existing, status, reason }
        receipts.set(assetId, next)
        try {
          savePaperTaskImageReceipts(context.workspaceRoot, this.branch, [...receipts.values()])
        } catch {
          this.receiptPersistenceFailed = true
        }
      },
    })
    if (this.closing || signal?.aborted) {
      await guard.close()
      return false
    }
    this.guard = guard
    const runtimeHome = this.home
    const pluginPath = resolve(process.cwd(), 'server', 'paper-task', 'controlled-tools.mjs')
    const providerConfig = JSON.stringify({ providers: { 'paper-task-provider': {
      displayName: context.provider.providerLabel,
      api: context.provider.protocol,
      baseURL: guard.baseUrl,
      apiKeyEnv: 'PAPER_TASK_MODEL_API_KEY',
      defaultMaxTokens: positiveIntegerEnv('PAPER_TASK_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS),
      ...(context.provider.imageInput ? {
        requestImagePixelBudget: IMAGE_LIMITS.maxDimension ** 2,
        requestImageMaxBytes: IMAGE_LIMITS.maxImageBytes,
        maxRequestImageBytes: IMAGE_LIMITS.maxBase64ImageBytes,
      } : {}),
      models: [{ id: context.provider.model, input: context.provider.imageInput ? ['text', 'image'] : ['text'] }],
      retryPolicy: { mode: 'normal', maxRetries: 0 },
    } } })
    const patchPath = join(runtimeHome, 'paper-task.cordis.patch.yml')
    writeFileSync(patchPath, [
      '- insert:',
      '    - id: llm-pi-ai',
      "      name: '@deepseek-ai/dsh-llm-pi-ai'",
      '      inject: [llm]',
      `      config: !!js "JSON.parse(process.env.PAPER_TASK_PROVIDER_CONFIGURATION)"`,
      ...(context.provider.imageInput ? [
        '    - id: paper-task-attachments',
        "      name: '@deepseek-ai/dsh-attachment-local'",
        '      config:',
        '        dshHome: !!js process.env.PAPER_TASK_ATTACHMENTS_HOME',
        `        maxImageBytes: ${IMAGE_LIMITS.maxImageBytes}`,
        `        maxImagesPerMessage: ${IMAGE_LIMITS.maxImages}`,
        `        maxMessageImageBytes: ${IMAGE_LIMITS.maxRawImageBytes}`,
        `        maxImagePixels: ${IMAGE_LIMITS.maxPixels}`,
        `        maxImageDimension: ${IMAGE_LIMITS.maxDimension}`,
        `        normalizedImageMaxPixels: ${IMAGE_LIMITS.maxPixels}`,
        `        normalizedImageMaxDimension: ${IMAGE_LIMITS.maxDimension}`,
        `        normalizedImageMaxBytes: ${IMAGE_LIMITS.maxImageBytes}`,
      ] : []),
      '    - id: token-meter',
      "      name: '@deepseek-ai/dsh-token-meter'",
      '    - id: compaction-basic',
      "      name: '@deepseek-ai/dsh-compaction-basic'",
      '      config:',
      '        maxTokens: 8192',
      '        headroomTokens: 8192',
      '    - id: paper-task-controlled-tools',
      `      name: ${JSON.stringify(pluginPath)}`,
      '      inject: [tools]',
      '- id: persistent-bash', '  disabled: true',
      '- id: persistent-pwsh', '  disabled: true',
      '- id: llm-retry', '  disabled: true',
      '- id: mcp-resources', '  disabled: true', '',
    ].join('\n'), { flag: 'wx', mode: 0o600 })
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      PAPER_TASK_PROVIDER_CONFIGURATION: providerConfig,
      PAPER_TASK_WORKSPACE: context.workspaceRoot,
      PAPER_TASK_SOURCE_ROOT: join(context.workspaceRoot, 'source.md'),
      PAPER_TASK_RESOURCE_ROOT: context.resourcesRoot,
      PAPER_TASK_INPUT: context.taskInputPath,
      PAPER_TASK_BRANCH_ROOT: options.branchWorkspaceDir ?? '',
      PAPER_TASK_BRANCH: options.branch,
      PAPER_TASK_MODEL_API_KEY: context.provider.apiKey || 'paper-task-no-auth',
      PAPER_TASK_ATTACHMENTS_HOME: join(runtimeHome, 'attachments-home'),
    }
    this.harness = new DeepSeekHarness({
      profile: 'sdk-minimal', dshBin, dshHome: join(runtimeHome, 'harness-home'),
      processCwd: context.workspaceRoot, cwd: context.workspaceRoot,
      provider: 'paper-task-provider', model: context.provider.model,
      patches: [patchPath], env, initializeTimeoutMs: 15000, requestTimeoutMs: 300000,
      shutdownTimeoutMs: 3000, disposeEofGraceMs: 1500, disposeGraceMs: 2000,
    })
    return true
  }

}

function boundedFinalResponse(result: Awaited<ReturnType<DeepSeekHarness['run']>>): string {
  return result.finalResponse.replace(/[\r\n\t]+/gu, ' ').slice(0, 500) || 'unavailable'
}
