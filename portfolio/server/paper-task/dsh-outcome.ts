import type { RunResult } from '@deepseek-ai/dsh-sdk-client'
import { z } from 'zod'

const eventSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) }).passthrough()
const MAX_MESSAGE_LENGTH = 500
const TOOL_NAMES = ['paper_task_read_input', 'paper_task_list_sources', 'paper_task_read_source', 'paper_task_search_source', 'paper_task_list_resources', 'paper_task_read_resource', 'paper_task_read_branch', 'paper_task_write_branch', 'paper_task_submit_content_review', 'paper_task_apply_local_repair'] as const
const TOOL_NAME_SET: ReadonlySet<string> = new Set(TOOL_NAMES)

export type DshRunDiagnostics = {
  readonly stage: 'primary' | 'recovery'
  readonly sessionId?: string
  readonly endReasons: readonly { readonly kind: string; readonly code?: string; readonly message?: string; readonly status?: number }[]
  readonly toolCounts: Readonly<Record<string, number>>
  readonly failedTools: readonly { readonly tool: string; readonly code?: string; readonly message?: string }[]
  readonly finalTextLength?: number
  readonly finalTextPrefix?: string
  readonly runRejected?: boolean
  readonly rejectedMessage?: string
  readonly interrupted?: 'aborted' | 'timeout'
}

export function diagnoseRun(result: RunResult, stage: DshRunDiagnostics['stage'], apiKey: string): DshRunDiagnostics {
  return diagnoseEvents(result.events, stage, apiKey, result.sessionId, result.finalResponse)
}

export function diagnoseEvents(events: readonly unknown[], stage: DshRunDiagnostics['stage'], apiKey: string, sessionId?: string, finalResponse = ''): DshRunDiagnostics {
  const ends: DshRunDiagnostics['endReasons'][number][] = []
  const calls = new Map<string, string>()
  const counts: Record<string, number> = {}
  const failures: { tool: string; code?: string; message?: string }[] = []
  for (const raw of events) {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) continue
    const { type, data } = parsed.data
    if (type === 'turn/end') {
      const reason = data.reason
      if (reason !== null && typeof reason === 'object' && 'kind' in reason && typeof reason.kind === 'string') {
        const failure = 'error' in reason ? reason.error : undefined
        if (failure !== null && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string') {
          ends.push({ kind: reason.kind, ...('code' in failure && typeof failure.code === 'string' ? { code: clean(failure.code, apiKey) } : {}), message: clean(failure.message, apiKey), ...('status' in failure && typeof failure.status === 'number' ? { status: failure.status } : {}) })
        } else ends.push({ kind: reason.kind })
      }
    }
    if (type === 'tool/call' && typeof data.callId === 'string' && typeof data.name === 'string') {
      calls.set(data.callId, data.name)
      if (TOOL_NAME_SET.has(data.name)) counts[data.name] = (counts[data.name] ?? 0) + 1
    }
    if (type === 'tool/result') {
      const message = data.message
      if (message !== null && typeof message === 'object' && 'isError' in message && message.isError === true && 'toolCallId' in message && typeof message.toolCallId === 'string') {
        const tool = calls.get(message.toolCallId)
        const text = toolErrorText(message)
        const reason = typeof data.error === 'object' && data.error !== null && 'reason' in data.error && typeof data.error.reason === 'string'
          ? data.error.reason
          : text ?? (typeof data.error === 'object' && data.error !== null && 'name' in data.error && typeof data.error.name === 'string' ? data.error.name : undefined)
        if (tool !== undefined) failures.push({ tool, ...(typeof data.error === 'object' && data.error !== null && 'code' in data.error && typeof data.error.code === 'string' ? { code: clean(data.error.code, apiKey) } : {}), ...(reason === undefined ? {} : { message: clean(reason, apiKey) }) })
      }
    }
  }
  const finalText = clean(finalResponse, apiKey)
  return {
    stage,
    ...(sessionId === undefined ? {} : { sessionId: clean(sessionId, apiKey) }),
    endReasons: ends.slice(0, 8),
    toolCounts: counts,
    failedTools: failures.slice(0, 8),
    finalTextLength: finalResponse.length,
    finalTextPrefix: finalText.slice(0, MAX_MESSAGE_LENGTH),
  }
}

export function terminalRunFailure(result: RunResult): string | undefined {
  const finalEnd = finalRootTurnEnd(result)
  if (finalEnd === undefined || finalEnd.data.reason.kind === 'completed') return undefined
  if (finalEnd.data.reason.kind === 'error') {
    const failure = finalEnd.data.reason.error
    return `${failure.code}: ${failure.message}`
  }
  return `turn ended with ${finalEnd.data.reason.kind}`
}

export function isCompletedRun(result: RunResult): boolean {
  return finalRootTurnEnd(result)?.data.reason.kind === 'completed'
}

function finalRootTurnEnd(result: RunResult): Extract<RunResult['events'][number], { type: 'turn/end' }> | undefined {
  let final: Extract<RunResult['events'][number], { type: 'turn/end' }> | undefined
  for (const event of result.events) {
    if (event.type === 'turn/end' && (final === undefined || event.data.turn > final.data.turn)) final = event
  }
  return final
}

export function hasFailedWrite(result: RunResult): boolean {
  const writeCalls = new Set(result.events.filter((event): event is Extract<RunResult['events'][number], { type: 'tool/call' }> => event.type === 'tool/call' && event.data.name === 'paper_task_write_branch').map((event) => event.data.callId))
  return result.events.some((event) => event.type === 'tool/result' && event.data.message.isError === true && writeCalls.has(event.data.message.toolCallId))
}

export function failedWriteFailure(result: RunResult): string | undefined {
  const calls = new Set(result.events.filter((event): event is Extract<RunResult['events'][number], { type: 'tool/call' }> => event.type === 'tool/call' && event.data.name === 'paper_task_write_branch').map((event) => event.data.callId))
  const failure = result.events.findLast((event) => event.type === 'tool/result' && event.data.message.isError === true && calls.has(event.data.message.toolCallId))
  if (failure?.type !== 'tool/result') return undefined
  const error = failure.data.error
  const text = toolErrorText(failure.data.message)
  return error === undefined
    ? `paper_task_write_branch failed${text === undefined ? '' : `: ${text}`}`
    : `paper_task_write_branch failed${error.code.length > 0 ? ` (${error.code})` : ''}: ${error.reason ?? text ?? error.name}`
}

export function safeDiagnosticEvent(raw: unknown, apiKey: string): unknown | undefined {
  const parsed = eventSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const { type, data } = parsed.data
  if (type === 'turn/end') {
    const reason = data.reason
    if (reason === null || typeof reason !== 'object' || !('kind' in reason) || typeof reason.kind !== 'string') return undefined
    const failure = 'error' in reason ? reason.error : undefined
    if (failure === null || typeof failure !== 'object') return { type, data: { turn: data.turn, reason: { kind: reason.kind } } }
    if (!('message' in failure) || typeof failure.message !== 'string') return undefined
    return { type, data: { turn: data.turn, reason: { kind: reason.kind, error: {
      code: 'code' in failure && typeof failure.code === 'string' ? clean(failure.code, apiKey) : 'UNKNOWN',
      message: clean(failure.message, apiKey),
      ...('status' in failure && typeof failure.status === 'number' ? { status: failure.status } : {}),
    } } } }
  }
  if (type === 'tool/call' && typeof data.callId === 'string' && typeof data.name === 'string' && TOOL_NAME_SET.has(data.name)) {
    return { type, data: { callId: data.callId, name: data.name } }
  }
  if (type === 'tool/result') {
    const message = data.message
    if (message === null || typeof message !== 'object' || !('toolCallId' in message) || typeof message.toolCallId !== 'string' || !('isError' in message) || typeof message.isError !== 'boolean') return undefined
    const error = data.error
    const text = toolErrorText(message)
    const summary = error !== null && typeof error === 'object' ? {
      ...('name' in error && typeof error.name === 'string' ? { name: clean(error.name, apiKey) } : {}),
      ...('code' in error && typeof error.code === 'string' ? { code: clean(error.code, apiKey) } : {}),
      ...('reason' in error && typeof error.reason === 'string' ? { reason: clean(error.reason, apiKey) } : text === undefined ? {} : { reason: clean(text, apiKey) }),
    } : text === undefined ? undefined : { reason: clean(text, apiKey) }
    return { type, data: { message: { toolCallId: message.toolCallId, isError: message.isError }, ...(summary === undefined ? {} : { error: summary }) } }
  }
  return undefined
}

function toolErrorText(message: unknown): string | undefined {
  if (message === null || typeof message !== 'object' || !('isError' in message) || message.isError !== true
    || !('content' in message) || !Array.isArray(message.content)) return undefined
  const blocks: readonly unknown[] = message.content
  const texts: string[] = []
  for (const block of blocks.slice(0, 4)) {
    if (block !== null && typeof block === 'object' && 'type' in block && block.type === 'text'
      && 'text' in block && typeof block.text === 'string') texts.push(block.text.slice(0, 2000))
  }
  return texts.join(' ').slice(0, 2000) || undefined
}

export function clean(value: string, apiKey: string): string {
  const keyed = apiKey.length > 0 ? value.replaceAll(apiKey, '[redacted]') : value
  return keyed.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;"']+/giu, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [redacted]')
    .replace(/\b(?:api[_ -]?key|x-api-key)(\s*[:=]\s*)[^\s,;"']+/giu, '$1[redacted]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/giu, '[image data redacted]')
    .slice(0, 2000)
}
