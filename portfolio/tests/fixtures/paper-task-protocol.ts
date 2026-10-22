import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const requestSchema = z.object({
  model: z.string(), stream: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.string(), content: z.unknown(),
    tool_calls: z.array(z.object({ id: z.string().optional(), function: z.object({ name: z.string(), arguments: z.string() }).optional() })).optional(),
    tool_call_id: z.string().optional(),
  })).optional(),
  tools: z.array(z.object({ function: z.object({ name: z.string() }).passthrough() })).optional(),
})
export type FixtureBody = z.infer<typeof requestSchema>
export type Decision = { readonly tool: string; readonly arguments: object } | { readonly content: string }
export const pageSchema = z.object({ text: z.string(), nextOffset: z.number(), totalBytes: z.number() })
const argumentsSchema = z.record(z.string(), z.unknown())

export function callsAndResults(body: FixtureBody) {
  const calls = new Map<string, { readonly name: string; readonly arguments: Record<string, unknown>; output?: string }>()
  for (const message of body.messages ?? []) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) {
      if (call.id !== undefined && call.function !== undefined) {
        calls.set(call.id, { name: call.function.name, arguments: argumentsSchema.parse(JSON.parse(call.function.arguments)) })
      }
    }
    if (message.role === 'tool' && message.tool_call_id !== undefined) {
      const call = calls.get(message.tool_call_id)
      if (call !== undefined) call.output = contentText(message.content)
    }
  }
  return [...calls.values()]
}

export async function respond(request: IncomingMessage, response: ServerResponse, peer: { readonly choose: (body: FixtureBody) => Decision; readonly translationGate: Promise<void> }): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if ((body.tools?.length ?? 0) > 0 && (body.messages ?? []).some(message => message.role === 'user' && contentText(message.content).includes('[paper-task:translation]'))) await peer.translationGate
  const decision = peer.choose(body)
  const id = randomUUID()
  const toolCall = 'tool' in decision
  const message = toolCall
    ? { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: decision.tool, arguments: JSON.stringify(decision.arguments) } }] }
    : { role: 'assistant', content: decision.content }
  const finishReason = toolCall ? 'tool_calls' : 'stop'
  if (body.stream === true) {
    const delta = toolCall
      ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: decision.tool, arguments: JSON.stringify(decision.arguments) } }] }
      : { role: 'assistant', content: decision.content }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
    response.end([
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}`,
      'data: [DONE]', '',
    ].join('\n\n'))
    return
  }
  response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
  response.end(JSON.stringify({ id, object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: finishReason }] }))
}

export async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('protocol fixture did not bind TCP port')
  return `http://127.0.0.1:${address.port}/v1`
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolveClose, reject) => server.close((error) => error === undefined ? resolveClose() : reject(error)))
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  return z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(content)
    .filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
}
