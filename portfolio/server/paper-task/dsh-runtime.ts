import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-client'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { IMAGE_LIMITS, type PaperTaskImageReceipt } from '../../app/utils/paper-task-image-contract'
import type { PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import type { PaperTaskStage } from '../../app/utils/paper-task-contract'
import type { PaperTaskBranchResult, PaperTaskCloseResult, PaperTaskRuntime, PaperTaskRuntimeEvent, PaperTaskRuntimeOptions } from './runtime'
import { verifyPinnedDsh } from './dsh-pin'
import { preparePaperTaskImages, type PreparedPaperTaskImage } from './image-input'
import { startPaperTaskImageGuard } from './image-request-guard'
import { savePaperTaskImageReceipts } from './image-receipts'
import { hasSuccessfulBranchWrite, translationMasterMatches } from './branch-output'

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
      this.initializationPromise = this.initialize(signal)
      const initialized = await this.initializationPromise
      if (!initialized || signal?.aborted) return []
      const prompt = this.branch === 'deep-reading'
        ? 'You are generating only the deep-reading branch. Call paper_task_read_input with no arguments first and follow its whole-paper task instructions. Read the complete pinned deep-reading SKILL.md and a suitable required framework reference, then discover and read every original source record completely with the supplied tools. Continue paged reads at nextOffset until totalBytes. Synthesize a connected natural Markdown report from the whole paper; include required claim_evidence entries that distinguish facts from inferences and link important passages to known verbatim source quotes. Save it as an unfinished preview with paper_task_write_branch and the identifiers of every source record read. Do not call any other tools.'
        : `You are generating only the translation branch. Call paper_task_read_input with no arguments first and follow its whole-paper task instructions. Read the complete pinned translation SKILL.md; this task's instructions override conflicting general clauses. Discover the complete source index with paper_task_list_sources, paging until totalItems. Read every indexed source record completely, continuing each paged read at nextOffset until totalBytes. Produce one continuous natural Chinese Markdown master in single-column article order: body, appendices, footnotes, and figure/table captions. Keep reference entries in English. Never translate, rebuild, or redraw table contents; keep each table as its original asset with a translated caption using ![caption](asset:ASSET_ID). Formulas and algorithms may also keep their original assets. Use terminology consistently and preserve source numbers and units. For necessary missing or unrecoverable material, add a short reader-visible note (for example 待补 or 未核实) and list it in unresolved; never guess. Save with paper_task_write_branch using segments, terminology, and unresolved. Do not produce a bilingual layout or a fixed article template. Do not call any other tools.`
      const promptBlocks: SdkPromptContentBlock[] = [{ type: 'text', text: prompt }]
      for (const image of this.preparedImages) {
        promptBlocks.push({ type: 'text', text: image.context })
        promptBlocks.push({ type: 'image', data: image.data, mimeType: 'image/png' })
      }
      const harness = this.harness
      if (harness === undefined) return []
      const run = harness.run(promptBlocks)
      const outcome = await Promise.race([run, aborted])
      if (outcome === undefined || signal?.aborted) return []
      if (this.receiptPersistenceFailed) return []
      const markdownPath = this.branch === 'translation'
        ? join(this.branchRoot, 'master.md')
        : join(this.branchRoot, 'report.md')
      const markdown = readFileSync(markdownPath, 'utf8')
      if (this.branch === 'translation') {
        if (!translationMasterMatches(this.branchRoot, markdown)) return []
      } else if (readFileSync(join(this.branchRoot, 'preview.md'), 'utf8') !== markdown) {
        return []
      }
      if (!hasSuccessfulBranchWrite(outcome, markdown, this.branch)) return []
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
      defaultMaxTokens: 8192,
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
      PAPER_TASK_SOURCE_ROOT: join(context.workspaceRoot, 'source-records'),
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
      patches: [patchPath], env, initializeTimeoutMs: 15000, requestTimeoutMs: 120000,
      shutdownTimeoutMs: 3000, disposeEofGraceMs: 1500, disposeGraceMs: 2000,
    })
    return true
  }

}
