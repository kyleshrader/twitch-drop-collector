// Local HTTP server for client tests: real sockets, scripted responses, recorded requests.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Logger, Scheduler } from '@tdc/kernel'
import { vi } from 'vitest'

export interface RecordedRequest {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: string
}

export interface MockReply {
  status?: number
  headers?: Record<string, string>
  body?: string | object
  /** Wait this long before replying (to trigger client timeouts). */
  delayMs?: number
}

export type MockHandler = (request: RecordedRequest) => MockReply | Promise<MockReply>

export interface MockServer {
  url: string
  server: Server
  requests: RecordedRequest[]
  handle(handler: MockHandler): void
  close(): Promise<void>
}

export async function startMockServer(): Promise<MockServer> {
  const requests: RecordedRequest[] = []
  let handler: MockHandler = () => ({ status: 404 })
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }
      requests.push(recorded)
      void Promise.resolve(handler(recorded)).then((reply) => {
        const send = (): void => {
          if (res.destroyed) return
          const body =
            reply.body === undefined
              ? ''
              : typeof reply.body === 'string'
                ? reply.body
                : JSON.stringify(reply.body)
          res.writeHead(reply.status ?? 200, reply.headers)
          res.end(body)
        }
        if (reply.delayMs) setTimeout(send, reply.delayMs)
        else send()
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    requests,
    handle: (next) => {
      handler = next
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** Resolves sleeps immediately and records the requested delays. */
export function recordingScheduler(): Scheduler & { delays: number[] } {
  const delays: number[] = []
  return {
    delays,
    sleep: async (ms, signal) => {
      delays.push(ms)
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    }
  }
}

export function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}
