import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { acceptsRetainedResult, parseArgs } from './paper-task-generation-local/acceptance.mjs'

const TITLE = 'paper-task:generation-local'
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']

function help() {
  console.log(`${TITLE}\nUsage: node scripts/paper-task-generation-local.mjs --allow-paid [--pdf=<path>] [--timeout-ms=<1..3600000>] [--selection=translation|deep-reading|both] [--env=test|development]\nReads only LLM_BASE_URL, LLM_MODEL_ID, LLM_API_KEY, and optional LLM_PROTOCOL from the selected local file (test: .env.test.local; development: .env). Defaults to the controlled fixture PDF; outputs are retained in .data/paper-tasks. A provider call may incur charges.`)
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

async function execute(selection, settings, pdfPath, timeoutMs) {
  const started = Date.now()
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
  const { evaluateBranchQuality } = await jiti.import('../server/paper-task/branch-quality.ts')
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
  let terminal
  let inputPdf
  try {
    const capturedSettings = getPaperTaskProviderSettings()
    if (capturedSettings === undefined || Object.keys(settings).some((key) => capturedSettings[key] !== settings[key])) {
      throw new Error('provider settings unavailable')
    }
    service = createPaperTaskService()
    inputPdf = new Uint8Array(readFileSync(pdfPath))
    const submit = await service.submit({ pdf: inputPdf, selection }, { signal: controller.signal })
    if (!submit.ok) throw new Error('submit')
    taskId = submit.taskId
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new Error('timeout'))
      }, timeoutMs)
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
          terminal = event
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
  const reader = taskId === undefined ? undefined : service.reader(taskId)
  const originalPdf = taskId === undefined ? undefined : service.originalPdf(taskId)
  const reviews = taskId === undefined ? {} : Object.fromEntries(selectedBranches.map((branch) => [
    branch,
    evaluateBranchQuality(resolve(process.cwd(), '.data', 'paper-tasks', 'project-local', taskId), branch),
  ]))
  outcome = controller.signal.aborted ? 'cancelled' : terminal !== undefined && inputPdf !== undefined && acceptsRetainedResult({
    terminal,
    selection,
    generatedBranches,
    reviews,
    reader,
    originalPdf,
    inputPdf,
  }) ? 'succeeded' : 'failed'
  const reportCharacters = selectedBranches.reduce((total, branch) => {
    const document = reader?.documents.find((candidate) => candidate.branch === branch)
    return total + (document?.markdown.length ?? 0)
  }, 0)
  const reviewsCompleted = selectedBranches.filter((branch) => reviews[branch]?.reviewCompleted === true).length
  const source = taskId === undefined ? undefined : service.source(taskId)
  console.log(`${TITLE}: outcome=${outcome} cleanup=${cleanup}`)
  console.log(`taskId=${taskId ?? 'unavailable'} retained=${taskId === undefined ? 'false' : 'true'}`)
  console.log(`stages=${[...stages].join(',') || 'none'} generatedBranches=${generatedBranches.size}/${selectedBranches.length} previews=${previewCount} paragraphs=${previewParagraphs}`)
  console.log(`reviewsCompleted=${reviewsCompleted}/${selectedBranches.length} reportCharacters=${reportCharacters}`)
  console.log(`sourcePages=${source?.source.pageCount ?? 0} sourceRecords=${source?.source.records.length ?? 0} elapsedMs=${Date.now() - started}`)
  console.log(`runtimeEvents=${[...runEvents].join(',') || 'none'} toolFailures=${[...toolFailures].join(',') || 'none'}`)
  return outcome === 'succeeded' && cleanup === 'clean' ? 0 : 1
}

export async function main(args) {
  const parsed = parseArgs(args, process.cwd())
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
    return await execute(parsed.selection, config.settings, parsed.pdfPath, parsed.timeoutMs)
  } catch {
    console.error(`${TITLE}: generation failed or timed out; sensitive provider details were suppressed.`)
    return 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
