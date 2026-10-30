// Checks, in the real main process, what @tdc/api relies on: net.fetch passes our headers and
// body through, and the runtime has WebSocket and AbortSignal.any.
import { expect, test } from '@playwright/test'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { launchApp } from './app'

test('net.fetch sends our headers and body unchanged', async () => {
  const seen: { headers: IncomingHttpHeaders; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      seen.push({ headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gql`

  const { app } = await launchApp()
  try {
    const result = await app.evaluate(async ({ net }, target) => {
      const response = await net.fetch(target, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dalvik/2.1.0 tdc-e2e',
          'Client-Id': 'client-123',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operationName: 'Inventory' }),
        signal: AbortSignal.any([AbortSignal.timeout(5000)])
      })
      return { status: response.status, text: await response.text() }
    }, url)

    expect(result).toEqual({ status: 200, text: '{"ok":true}' })
    expect(seen[0]?.headers['user-agent']).toBe('Dalvik/2.1.0 tdc-e2e')
    expect(seen[0]?.headers['client-id']).toBe('client-123')
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({ operationName: 'Inventory' })

    const runtime = await app.evaluate(() => ({
      webSocket: typeof WebSocket,
      abortAny: typeof AbortSignal.any
    }))
    expect(runtime).toEqual({ webSocket: 'function', abortAny: 'function' })
  } finally {
    await app.close()
    server.close()
  }
})
