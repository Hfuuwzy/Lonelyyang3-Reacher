import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'
import {
  observeRequestDisconnect,
  type RequestDisconnect,
} from '../../server/utils/paper-review/disconnect'
import type { PaperReviewStreamEvent } from '../../app/utils/paper-review-contract'
import {
  runPaperReview,
  type HarnessFactory,
  type PaperReviewHarnessResult,
  type PaperReviewRunInput,
} from '../../server/utils/paper-review/harness'
import {
  createPaperReviewEvents,
  type PaperReviewPipelineDependencies,
} from '../../server/utils/paper-review/pipeline'
import type { PaperReviewMultipartPart } from '../../server/utils/paper-review/multipart'

/** A small deferred; the two disconnect scenarios that need one. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let server: Server | undefined

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind to a port')
  }
  return address.port
}

function uploadParts(): PaperReviewMultipartPart[] {
  const field = (name: string, value: string): PaperReviewMultipartPart => ({ name, data: new TextEncoder().encode(value) })
  return [
    { name: 'pdf', filename: 'paper.pdf', type: 'application/pdf', data: new TextEncoder().encode('%PDF-1.7 test') },
    field('providerLabel', 'Local provider'),
    field('baseUrl', 'https://gateway.example/v1'),
    field('protocol', 'openai-completions'),
    field('model', 'reviewer-test'),
    field('apiKey', 'sk-paper-review-test'),
  ]
}

describe('observeRequestDisconnect close semantics', () => {
  it('propagates a real response disconnect through the pipeline and closes that Harness', async () => {
    const parts = uploadParts()
    const runStarted = deferred()
    const streamCompleted = deferred()
    const requestHandled = deferred()
    const streamEvents: PaperReviewStreamEvent[] = []
    const launches: DeepSeekHarnessOptions[] = []
    let resolveRun!: (result: { sessionId: string; finalResponse: string; events: never[] }) => void
    let closeCalls = 0
    let verifyCalls = 0
    let tempHome: string | undefined
    let streamFailure: unknown
    const pendingRun = new Promise<{ sessionId: string; finalResponse: string; events: never[] }>((resolve) => {
      resolveRun = resolve
    })
    const fakeHarnessFactory: HarnessFactory = (options) => {
      launches.push(options)
      tempHome = options.dshHome
      return {
        run: () => {
          runStarted.resolve()
          return pendingRun
        },
        close: async () => {
          closeCalls += 1
          resolveRun({ sessionId: 'closed-session', finalResponse: '{}', events: [] })
        },
      }
    }
    const input: PaperReviewRunInput = {
      providerLabel: 'Local provider',
      baseUrl: 'https://gateway.example/v1',
      protocol: 'openai-completions',
      model: 'reviewer-test',
      apiKey: 'sk-paper-review-test',
    }
    const dependencies: PaperReviewPipelineDependencies = {
      extractPaperPages: async () => ({ success: true, pageCount: 0, pages: [] }),
      runPaperReview: (runInput, request, runnerDependencies, options) => runPaperReview(
        runInput,
        request,
        {
          ...runnerDependencies,
          harnessFactory: fakeHarnessFactory,
          resolveLocalDshBin: () => ({ ok: true, dshBin: join(tmpdir(), 'paper-review-disconnect-test-dsh.js') }),
        },
        options,
      ),
      verifyPaperReview: () => {
        verifyCalls += 1
        return { success: true, report: { status: 'incomplete', provider: input.providerLabel, model: input.model, sections: [], gaps: [], missingScope: ['full-translation'] } }
      },
    }

    const port = await listen((req, res) => {
      requestHandled.resolve()
      const disconnect = observeRequestDisconnect(req, res)
      req.resume()
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': connected\n\n')
      void (async () => {
        try {
          for await (const event of createPaperReviewEvents(parts, dependencies, { signal: disconnect.signal })) {
            streamEvents.push(event)
            if (!disconnect.signal.aborted) {
              res.write(`data: ${JSON.stringify(event)}\n\n`)
            }
          }
        } catch (error) {
          streamFailure = error
        } finally {
          disconnect.dispose()
          res.end()
          streamCompleted.resolve()
        }
      })()
    })

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello')
    await requestHandled.promise
    const pipelineState = await Promise.race([
      runStarted.promise.then(() => 'running' as const),
      streamCompleted.promise.then(() => 'completed' as const),
    ])
    expect(pipelineState, `${JSON.stringify(streamEvents)}; ${String(streamFailure)}`).toBe('running')
    socket.destroy()
    await streamCompleted.promise

    const terminal = streamEvents.at(-1)
    const activeStage = streamEvents.filter((event) => event.type === 'stage').at(-1)
    expect(terminal).toEqual({
      type: 'error',
      stage: activeStage?.type === 'stage' ? activeStage.stage : undefined,
      code: 'cancelled',
      message: expect.any(String),
    })
    expect(streamFailure).toBeUndefined()
    expect(closeCalls).toBe(1)
    expect(verifyCalls).toBe(0)
    expect(launches).toHaveLength(1)
    expect(tempHome).toBeDefined()
    expect(existsSync(tempHome!)).toBe(false)
  })
})