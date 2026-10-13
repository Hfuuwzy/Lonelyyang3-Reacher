import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { createJiti } from 'jiti'

const TITLE = 'paper-task:generation-local'
const SOURCE_PATH = resolve(process.cwd(), 'tests/fixtures/paper-task-source-fixture.pdf')
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const RUN_LIMIT_MS = 210_000

function help() {
  console.log(`${TITLE}\nUsage: node scripts/paper-task-generation-local.mjs --allow-paid [--selection=translation|deep-reading|both] [--env=test|development]\nReads only LLM_BASE_URL, LLM_MODEL_ID, LLM_API_KEY, and optional LLM_PROTOCOL from the selected local file (test: .env.test.local; development: .env). Uses the controlled fixture PDF; outputs are retained in .data/paper-tasks. A provider call may incur charges.`)
}

function parseArgs(args) {
  let allowPaid = false
  let selection = 'both'
  let environment = 'test'
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--allow-paid') allowPaid = true
    else if (arg.startsWith('--selection=')) selection = arg.slice('--selection='.length)
    else if (arg.startsWith('--env=')) environment = arg.slice('--env='.length)
    else return { error: 'arguments' }
  }
  if (!['translation', 'deep-reading', 'both'].includes(selection)) return { error: 'selection' }
  if (!['test', 'development'].includes(environment)) return { error: 'environment' }
  return { allowPaid, selection, environment }
}

function readProviderConfig(environment) {
  let env
  try {
    const filename = environment === 'development' ? '.env' : '.env.test.local'
    env = parseEnv(readFileSync(join(process.cwd(), filename), 'utf8'))
  } catch {
    return { error: 'config' }
  }
  const baseUrl = env.LLM_BASE_URL?.trim()
  const model = env.LLM_MODEL_ID?.trim()
  const apiKey = env.LLM_API_KEY ?? ''
  const protocol = env.LLM_PROTOCOL?.trim() || 'openai-completions'
  if (!baseUrl || !model || !PROTOCOLS.includes(protocol)) return { error: 'config' }
  let parsedUrl
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    return { error: 'config' }
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    return { error: 'config' }
  }
  return {
    settings: {
      providerLabel: parsedUrl.host,
      baseUrl,
      protocol,
      model,
      apiKey,
    },
  }
}

async function execute(selection, settings) {
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: true })
  const { DeepSeekHarness } = await jiti.import('@deepseek-ai/dsh-sdk-client')
  const originalRun = DeepSeekHarness.prototype.run
  const runEvents = new Set()
  const toolFailures = new Set()
  DeepSeekHarness.prototype.run = function (input, options) {
    return originalRun.call(this, input, options).then((result) => {
      for (const event of result.events) {
        runEvents.add(event.type)
        if (event.type === 'tool/result' && event.data.message.isError === true) {
          const text = event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text).join(' ')
          const call = result.events.find((candidate) => candidate.type === 'tool/call' && candidate.data.callId === event.data.message.toolCallId)
          if (call !== undefined && ['paper_task_read_input', 'paper_task_list_sources', 'paper_task_read_source', 'paper_task_list_resources', 'paper_task_read_resource', 'paper_task_read_branch', 'paper_task_write_branch'].includes(call.data.name)) toolFailures.add(call.data.name)
          for (const [pattern, code] of [[/complete pinned branch skill/, 'skill-not-loaded'], [/source dependenc|source_record_ids/, 'source-dependencies'], [/resource index/, 'resource-index'], [/page limits|page offset/, 'page-limits'], [/snapshot changed/, 'snapshot-changed'], [/unsupported resource/, 'resource-id'], [/unsupported source/, 'source-id'], [/ENOENT|no such file/, 'file-unavailable'], [/invalid.*argument|argument.*invalid|must be|required|Invalid arguments/i, 'invalid-arguments'], [/read limit/, 'read-limit']]) {
            if (pattern.test(text)) toolFailures.add(code)
          }
          toolFailures.add('tool-failed')
        }
      }
      return result
    }, (error) => {
      runEvents.add('sdk-run-rejected')
      throw error
    })
  }
  const { createPaperTaskService } = await jiti.import('../server/paper-task/coordinator.ts')
  const { replacePaperTaskProviderSettings, getPaperTaskProviderSettings, clearPaperTaskProviderSettings } = await jiti.import('../server/paper-task/provider-settings.ts')
  replacePaperTaskProviderSettings(settings)
  let service
  const controller = new AbortController()
  let taskId
  let timeout
  let outcome = 'failed'
  let cleanup = 'pending'
  let terminalSeen = false
  const stages = new Set()
  const selectedBranches = selection === 'both'
    ? ['translation', 'deep-reading']
    : [selection]
  const generatedBranches = new Set()
  let previewParagraphs = 0
  let previewCount = 0
  try {
    const capturedSettings = getPaperTaskProviderSettings()
    if (capturedSettings === undefined || Object.keys(settings).some((key) => capturedSettings[key] !== settings[key])) {
      throw new Error('provider settings unavailable')
    }
    service = createPaperTaskService()
    const pdf = new Uint8Array(readFileSync(SOURCE_PATH))
    const submit = await service.submit({ pdf, selection }, { signal: controller.signal })
    if (!submit.ok) throw new Error('submit')
    taskId = submit.taskId
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new Error('timeout'))
      }, RUN_LIMIT_MS)
    })
    await Promise.race([(async () => {
      for await (const event of submit.events) {
        if (event.type === 'progress') stages.add(event.stage)
        if (event.type === 'preview' && event.designation === 'generated-preview') {
          generatedBranches.add(event.branch)
          previewParagraphs += event.paragraphs.length
          previewCount += 1
        }
        if (event.type === 'terminal') {
          const selectedReady = selectedBranches.every((branch) => event.branches[branch] === 'preview-ready')
          const unselectedReady = ['translation', 'deep-reading']
            .filter((branch) => !selectedBranches.includes(branch))
            .every((branch) => event.branches[branch] === 'not-selected')
          const generatedAllSelected = selectedBranches.every((branch) => generatedBranches.has(branch))
          outcome = event.outcome === 'succeeded' && selectedReady && unselectedReady && generatedAllSelected
            ? 'succeeded'
            : 'failed'
          cleanup = event.cleanup
          terminalSeen = true
        }
      }
    })(), deadline])
  } catch {
    outcome = controller.signal.aborted ? 'cancelled' : 'failed'
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (taskId !== undefined && !terminalSeen) {
      controller.abort()
      const stopped = await service.cancel(taskId)
      if (cleanup === 'pending') cleanup = stopped.ok ? 'clean' : 'failed'
    }
    clearPaperTaskProviderSettings()
    DeepSeekHarness.prototype.run = originalRun
  }
  console.log(`${TITLE}: outcome=${outcome} cleanup=${cleanup}`)
  console.log(`taskId=${taskId ?? 'unavailable'} retained=${taskId === undefined ? 'false' : 'true'}`)
  console.log(`stages=${[...stages].join(',') || 'none'} generatedBranches=${generatedBranches.size}/${selectedBranches.length} previews=${previewCount} paragraphs=${previewParagraphs}`)
  console.log(`runtimeEvents=${[...runEvents].join(',') || 'none'} toolFailures=${[...toolFailures].join(',') || 'none'}`)
  return outcome === 'succeeded' && cleanup === 'clean' ? 0 : 1
}

async function main(args) {
  const parsed = parseArgs(args)
  if (parsed.help) {
    help()
    return 0
  }
  if (parsed.error) {
    console.error(`${TITLE}: invalid ${parsed.error}; use --help.`)
    return 1
  }
  if (!parsed.allowPaid) {
    console.error(`${TITLE}: --allow-paid is required; no config was read and no provider call was made.`)
    return 1
  }
  const config = readProviderConfig(parsed.environment)
  if (config.error) {
    console.error(`${TITLE}: local provider config is unavailable or invalid; values were not displayed.`)
    return 1
  }
  try {
    return await execute(parsed.selection, config.settings)
  } catch {
    console.error(`${TITLE}: generation failed or timed out; sensitive provider details were suppressed.`)
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
