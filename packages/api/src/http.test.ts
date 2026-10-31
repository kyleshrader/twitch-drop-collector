import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RequestFailedError } from './errors'
import { createHttpClient, type HttpClient } from './http'
import {
  recordingScheduler,
  startMockServer,
  testLogger,
  type MockServer
} from './test/mock-server'

let server: MockServer
beforeEach(async () => {
  server = await startMockServer()
})
afterEach(async () => {
  await server.close()
})

function client(options: { timeoutMs?: number } = {}): {
  http: HttpClient
  scheduler: ReturnType<typeof recordingScheduler>
} {
  const scheduler = recordingScheduler()
  const http = createHttpClient({
    fetch: (url, init) => fetch(url, init),
    userAgent: 'tdc-test/1.0',
    timeoutMs: () => options.timeoutMs ?? 2000,
    scheduler,
    logger: testLogger(),
    random: () => 0.5
  })
  return { http, scheduler }
}

describe('http client', () => {
  it('sends the user agent, headers and a JSON body, and returns the read body', async () => {
    server.handle(() => ({ status: 200, body: { ok: true } }))
    const response = await client().http.request({
      method: 'POST',
      url: `${server.url}/gql`,
      headers: { 'Client-Id': 'abc' },
      json: { query: 1 }
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.text)).toEqual({ ok: true })
    const recorded = server.requests[0]
    expect(recorded?.headers['user-agent']).toBe('tdc-test/1.0')
    expect(recorded?.headers['client-id']).toBe('abc')
    expect(recorded?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(recorded?.body ?? '')).toEqual({ query: 1 })
  })

  it('sends form bodies urlencoded', async () => {
    server.handle(() => ({ status: 200 }))
    await client().http.request({
      method: 'POST',
      url: `${server.url}/oauth2/device`,
      form: { client_id: 'abc', scopes: '' }
    })
    expect(server.requests[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(server.requests[0]?.body).toBe('client_id=abc&scopes=')
  })

  it('returns 4xx responses without retrying', async () => {
    server.handle(() => ({ status: 401, body: 'nope' }))
    const { http, scheduler } = client()
    const response = await http.request({ method: 'GET', url: `${server.url}/x` })
    expect(response).toMatchObject({ status: 401, text: 'nope' })
    expect(server.requests).toHaveLength(1)
    expect(scheduler.delays).toEqual([])
  })

  it('retries 5xx with growing backoff until it succeeds', async () => {
    let calls = 0
    server.handle(() => (++calls < 4 ? { status: 503 } : { status: 200, body: 'ok' }))
    const { http, scheduler } = client()
    const response = await http.request({ method: 'GET', url: `${server.url}/x` })
    expect(response.text).toBe('ok')
    expect(server.requests).toHaveLength(4)
    expect(scheduler.delays).toEqual([1000, 2000, 4000])
  })

  it('retries when the server is too slow, then gives up after maxAttempts', async () => {
    server.handle(() => ({ status: 200, delayMs: 500 }))
    const { http } = client({ timeoutMs: 50 })
    // Count attempts on the client: a slow runner can time out an attempt before the server
    // has read it.
    const failure = http.request({ method: 'GET', url: `${server.url}/slow`, maxAttempts: 2 })
    await expect(failure).rejects.toBeInstanceOf(RequestFailedError)
    await expect(failure).rejects.toMatchObject({ attempts: 2 })
    expect(server.requests.length).toBeGreaterThanOrEqual(1)
  })

  it('retries connection errors', async () => {
    const url = server.url
    await server.close()
    const { http, scheduler } = client()
    await expect(http.request({ method: 'GET', url, maxAttempts: 3 })).rejects.toMatchObject({
      name: 'RequestFailedError',
      attempts: 3
    })
    expect(scheduler.delays).toHaveLength(2)
    server = await startMockServer()
  })

  it('stops as soon as the caller aborts', async () => {
    server.handle(() => ({ status: 200, delayMs: 1000 }))
    const { http, scheduler } = client()
    const controller = new AbortController()
    const pending = http.request({
      method: 'GET',
      url: `${server.url}/x`,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(scheduler.delays).toEqual([])
  })

  it('reads the timeout setting on every attempt', async () => {
    let timeout = 50
    server.handle(() => ({ status: 200, body: 'late', delayMs: 150 }))
    const http = createHttpClient({
      fetch: (url, init) => fetch(url, init),
      userAgent: 'x',
      timeoutMs: () => timeout,
      scheduler: {
        sleep: async () => {
          timeout = 2000
        }
      },
      logger: testLogger()
    })
    const response = await http.request({ method: 'GET', url: `${server.url}/x` })
    expect(response.text).toBe('late')
    expect(server.requests).toHaveLength(2)
  })
})
