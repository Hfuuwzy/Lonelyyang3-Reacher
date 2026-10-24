/// <reference types="node" />
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDshRuntimeFactory } from '../../server/paper-task/dsh-runtime'
import type { PaperTaskRuntime, PaperTaskRuntimeOptions } from '../../server/paper-task/runtime'
import type { PaperTaskProviderSettings } from '../../app/utils/paper-task-provider-contract'
import { createPaperTaskWorkspace } from '../../server/paper-task/workspace'
import { createPaperTaskSourceStore } from '../../server/paper-task/source-store'
import { snapshotGenerationResources } from '../../server/paper-task/generation-resources'
import { writeTaskInput } from '../../server/paper-task/input'
import type { PaperTaskSource } from '../../app/utils/paper-task-source-contract'

const harnessCapture = vi.hoisted(() => ({
  options: [] as { readonly patches: readonly string[] }[],
  closes: 0,
}))

vi.mock('@deepseek-ai/dsh-sdk-client', () => ({
  DeepSeekHarness: class {
    constructor(options: { readonly patches: readonly string[] }) {
      harnessCapture.options.push(options)
    }

    run(): Promise<never> {
      return new Promise(() => undefined)
    }

    async close(): Promise<void> {
      harnessCapture.closes++
    }
  },
}))

vi.mock('../../server/paper-task/dsh-pin', () => ({ verifyPinnedDsh: () => 'not-launched' }))

const toolNames = [
  'paper_task_read_input',
  'paper_task_read_source',
  'paper_task_search_source',
  'paper_task_list_resources',
  'paper_task_read_resource',
  'paper_task_write_branch',
  'paper_task_read_branch',
  'paper_task_submit_content_review',
  'paper_task_apply_local_repair',
]

describe('paper-task controlled plugin loading', () => {
  afterEach(() => {
    harnessCapture.options.length = 0
    harnessCapture.closes = 0
  })

  it('loads the generated patch through DSH boot normalization and removes its tools on fiber disposal', async () => {
    const previousArgv = process.argv[1]
    const scratchRoot = resolve(process.cwd(), '..', '.opencode', 'tmp', 'spec57')
    mkdirSync(scratchRoot, { recursive: true })
    const tempRoot = mkdtempSync(join(scratchRoot, 'paper-task-plugin-loading-'))
    const envKeys = ['PAPER_TASK_WORKSPACE', 'PAPER_TASK_BRANCH_ROOT', 'PAPER_TASK_RESOURCE_ROOT', 'PAPER_TASK_INPUT', 'PAPER_TASK_BRANCH'] as const
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
    const abort = new AbortController()
    let runtime: PaperTaskRuntime | undefined
    let disposeContext: (() => Promise<void>) | undefined
    try {
      const taskId = '123e4567-e89b-12d3-a456-426614174000'
      const workspaceRoot = join(tempRoot, taskId)
      createPaperTaskWorkspace(workspaceRoot, new Uint8Array(Buffer.from('%PDF-1.4\ncontrolled fixture')))
      const source: PaperTaskSource = { status: 'complete', pageCount: 1, records: [{ id: 'p1-r0', order: 0, kind: 'body', text: 'The study reports an improvement. Its applicability is limited.', state: 'present', page: 1, bbox: [0, 0, 1, 1], sectionId: null, context: '', links: [] }] }
      createPaperTaskSourceStore().save(taskId, workspaceRoot, source, [])
      const skillRoot = join(tempRoot, 'skill')
      mkdirSync(skillRoot)
      writeFileSync(join(skillRoot, 'SKILL.md'), '# Fixture skill\nExplain the source and review applicability.')
      snapshotGenerationResources(workspaceRoot, ['deep-reading'], { 'deep-reading': skillRoot })
      writeTaskInput(workspaceRoot, taskId, 'deep-reading')
      const env = {
        PAPER_TASK_WORKSPACE: workspaceRoot,
        PAPER_TASK_BRANCH_ROOT: join(workspaceRoot, 'drafts', 'deep-reading'),
        PAPER_TASK_RESOURCE_ROOT: join(workspaceRoot, 'generation-resources'),
        PAPER_TASK_INPUT: join(workspaceRoot, 'task-input.md'),
        PAPER_TASK_BRANCH: 'deep-reading',
      }
      for (const key of envKeys) process.env[key] = env[key]

      const portfolioRequire = createRequire(resolve(process.cwd(), 'package.json'))
      const dshPackagePath = portfolioRequire.resolve('@deepseek-ai/dsh/package.json')
      const dshRequire = createRequire(dshPackagePath)
      const dshToolsPath = dirname(dshRequire.resolve('@deepseek-ai/dsh-tools/package.json'))
      const realCliRoot = join(tempRoot, 'cli-real')
      const lexicalCliRoot = join(tempRoot, 'cli-junction')
      const realCliLib = join(realCliRoot, 'apps', 'cli', 'lib')
      const lexicalCliLib = join(lexicalCliRoot, 'apps', 'cli', 'lib')
      const cliEntry = join(realCliLib, 'bin.js')
      const lexicalCliEntry = join(lexicalCliLib, 'bin.js')
      const toolsDependency = join(realCliRoot, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-tools')
      mkdirSync(dirname(cliEntry), { recursive: true })
      mkdirSync(dirname(toolsDependency), { recursive: true })
      mkdirSync(dirname(lexicalCliLib), { recursive: true })
      writeFileSync(cliEntry, '')
      symlinkSync(dshToolsPath, toolsDependency, process.platform === 'win32' ? 'junction' : 'dir')
      symlinkSync(realCliLib, lexicalCliLib, process.platform === 'win32' ? 'junction' : 'dir')
      expect(() => createRequire(lexicalCliEntry).resolve('@deepseek-ai/dsh-tools')).toThrow()
      expect(createRequire(cliEntry).resolve('@deepseek-ai/dsh-tools')).toBe(dshRequire.resolve('@deepseek-ai/dsh-tools'))

      const importDsh = (name: string) => import(pathToFileURL(dshRequire.resolve(name)).href)
      const [{ Context }, { default: SystemPrompt }, { default: Tools }, { default: Loader }, { loadOverlayPatches }] = await Promise.all([
        importDsh('@deepseek-ai/cordis'),
        importDsh('@deepseek-ai/dsh-system-prompt'),
        importDsh('@deepseek-ai/dsh-tools'),
        importDsh('@deepseek-ai/cordis-plugin-loader'),
        importDsh('@deepseek-ai/dsh-app-boot'),
      ])

      const runtimeHome = join(tempRoot, 'runtime-home')
      const provider: PaperTaskProviderSettings = {
        providerLabel: 'Controlled plugin fixture',
        baseUrl: 'http://127.0.0.1:1',
        protocol: 'openai-completions',
        model: 'fixture-model',
        imageInput: false,
        apiKey: '',
      }
      const options: PaperTaskRuntimeOptions = {
        branch: 'deep-reading',
        workContextPath: join(workspaceRoot, 'task-input.md'),
        branchWorkspaceDir: join(workspaceRoot, 'drafts', 'deep-reading'),
        runtimeHome,
        signal: abort.signal,
      }
      const ctx = new Context()
      disposeContext = () => ctx.fiber.dispose()
      runtime = createDshRuntimeFactory({
        provider,
        workspaceRoot,
        taskInputPath: join(workspaceRoot, 'task-input.md'),
        resourcesRoot: join(workspaceRoot, 'generation-resources'),
      })(options)
      await vi.waitFor(() => expect(harnessCapture.options).toHaveLength(1))
      const patchPath = harnessCapture.options[0]?.patches[0]
      expect(patchPath).toBeDefined()
      const patch = loadOverlayPatches('paper-task-test', patchPath!) as {
        readonly insert?: readonly { readonly id?: string; readonly name?: string; readonly inject?: readonly string[] }[]
      }[]
      const plugin = patch.flatMap((layer) => layer.insert ?? []).find((entry) => entry.id === 'paper-task-controlled-tools')
      expect(plugin?.name).toMatch(/^file:/u)
      if (plugin?.name === undefined || plugin.inject === undefined) throw new Error('generated controlled-tools entry is incomplete')

      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Loader)
      process.argv[1] = lexicalCliEntry
      expect(await ctx.loader.import(plugin.name)).toMatchObject({ name: 'paper-task-controlled-tools' })
      const id = await ctx.loader.create({ name: plugin.name, inject: [...plugin.inject] })
      expect(ctx.tools.schemas().map((tool: { readonly name: string }) => tool.name)).toEqual(toolNames)
      const advertised = (await ctx.systemPrompt.assemble()).tools.map((tool: { readonly name: string }) => tool.name)
      expect(advertised).toHaveLength(toolNames.length)
      expect(advertised).toEqual(expect.arrayContaining(toolNames))

      await ctx.loader.remove(id)
      expect(ctx.tools.schemas()).toHaveLength(0)
      expect((await ctx.systemPrompt.assemble()).tools).toHaveLength(0)
    } finally {
      abort.abort()
      try {
        if (runtime !== undefined) {
          await runtime.result
          expect(harnessCapture.closes).toBe(1)
        }
        await disposeContext?.()
      } finally {
        if (previousArgv === undefined) delete process.argv[1]
        else process.argv[1] = previousArgv
        for (const [key, value] of previousEnv) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        rmSync(tempRoot, { recursive: true, force: true })
      }
    }
  })
})
