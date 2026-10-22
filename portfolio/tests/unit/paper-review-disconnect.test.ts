import { afterEach, describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import {
  observeRequestDisconnect,
  type RequestDisconnect,
} from '../../server/utils/paper-review/disconnect'

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

describe('observeRequestDisconnect close semantics', () => {
  it('aborts the signal when the client destroys the connection before the request body completes', async () => {
    // Given a server observing the disconnect on a chunked request that never
    // sends its terminating zero-length chunk.
    let disconnect: RequestDisconnect | undefined
    const reqClosed = deferred()
    const observed = deferred()
    const port = await listen((req, res) => {
      disconnect = observeRequestDisconnect(req, res)
      req.on('error', () => {})
      req.on('close', () => reqClosed.resolve())
      req.resume()
      observed.resolve()
    })

    // When the client sends a partial chunked body and destroys the socket only
    // after the server has taken the request in flight.
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')
    socket.write('5\r\nhello\r\n')
    await observed.promise
    socket.destroy()

    // Then the server observes the premature close and the signal is aborted.
    await reqClosed.promise
    expect(disconnect?.signal.aborted).toBe(true)
  })

  it('aborts the signal when the client leaves mid-response before it is fully written', async () => {
    // Given a server that begins an SSE response but never ends it.
    let disconnect: RequestDisconnect | undefined
    const resClosed = deferred()
    const port = await listen((req, res) => {
      disconnect = observeRequestDisconnect(req, res)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"stage","stage":"analyzing"}\n\n')
      void once(res, 'close').then(() => resClosed.resolve())
      req.resume()
    })

    // When the client reads the partial response and then destroys the socket.
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello')
    await once(socket, 'data')
    socket.destroy()

    // Then the response close is observed with the response unfinished and the
    // disconnect signal is aborted.
    await resClosed.promise
    expect(disconnect?.signal.aborted).toBe(true)
  })

  it('does not abort the signal on a normal fully-written request and response', async () => {
    // Given a server observing the disconnect on a normal completed exchange.
    let disconnect: RequestDisconnect | undefined
    let resClosed = false
    const port = await listen((req, res) => {
      disconnect = observeRequestDisconnect(req, res)
      void once(res, 'close').then(() => {
        resClosed = true
      })
      void req.resume()
      res.end('ok')
    })

    // When the client sends a complete body with a matching Content-Length and
    // reads the complete response over a Connection: close socket.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: { 'Content-Length': '5', Connection: 'close' },
        },
        resolve,
      )
      req.on('error', reject)
      req.write('hello')
      req.end()
    })
    const chunks: Buffer[] = []
    for await (const chunk of response) {
      chunks.push(chunk)
    }

    // Then the response fully closes (writableFinished) and the signal stays un-aborted.
    expect(Buffer.concat(chunks).toString()).toBe('ok')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(resClosed).toBe(true)
    expect(disconnect?.signal.aborted).toBe(false)
  })

  it('disposes its listeners so a later premature close no longer aborts', async () => {
    // Given a server that disposes the disconnect binding immediately.
    let disconnect: RequestDisconnect | undefined
    const reqClosed = deferred()
    const observed = deferred()
    const port = await listen((req, res) => {
      disconnect = observeRequestDisconnect(req, res)
      disconnect.dispose()
      req.on('error', () => {})
      req.on('close', () => reqClosed.resolve())
      req.resume()
      observed.resolve()
    })

    // When the client sends a partial chunked body and destroys the socket only
    // after the server has taken the request in flight.
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n')
    socket.write('5\r\nhello\r\n')
    await observed.promise
    socket.destroy()

    // Then the premature close fires but, with the listeners removed, the
    // signal is never aborted.
    await reqClosed.promise
    expect(disconnect?.signal.aborted).toBe(false)
  })
})