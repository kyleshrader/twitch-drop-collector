import type { Net } from 'electron'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { applyProxy, createNetFetch, proxyConfig, requestTimeoutMs } from './network'

interface Reply {
  status?: number
  headers?: Record<string, string | string[]>
  body?: string
  error?: Error
  /** Never answer (to test abort). */
  hang?: boolean
}

/** Stand-in for net.request: records what was sent and plays back a reply. */
function fakeNet(reply: Reply) {
  const sent = {
    options: undefined as unknown,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    aborted: false
  }
  const net = {
    request: (options: unknown) => {
      sent.options = options
      const request = Object.assign(new EventEmitter(), {
        setHeader: (name: string, value: string) => {
          sent.headers[name] = value
        },
        abort: () => {
          sent.aborted = true
        },
        end: (body?: string) => {
          sent.body = body
          if (reply.hang) return
          setImmediate(() => {
            if (reply.error) {
              request.emit('error', reply.error)
              return
            }
            const response = Object.assign(new EventEmitter(), {
              statusCode: reply.status ?? 200,
              statusMessage: 'OK',
              headers: reply.headers ?? {}
            })
            request.emit('response', response)
            if (reply.body) response.emit('data', Buffer.from(reply.body))
            response.emit('end')
          })
        }
      })
      return request
    }
  }
  return { net: net as unknown as Pick<Net, 'request'>, sent }
}

describe('createNetFetch', () => {
  it('maps Origin and Referer to what net.request accepts, and sends other headers as-is', async () => {
    const { net, sent } = fakeNet({ body: '{}' })
    await createNetFetch(net)('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        Origin: 'https://www.twitch.tv',
        Referer: 'https://www.twitch.tv',
        'Client-Id': 'abc',
        'User-Agent': 'Dalvik/2.1.0'
      },
      body: '{"a":1}'
    })
    expect(sent.options).toEqual({
      method: 'POST',
      url: 'https://gql.twitch.tv/gql',
      redirect: 'follow',
      origin: 'https://www.twitch.tv',
      referrerPolicy: 'unsafe-url'
    })
    expect(sent.headers).toEqual({
      'client-id': 'abc',
      'user-agent': 'Dalvik/2.1.0',
      Referer: 'https://www.twitch.tv'
    })
    expect(sent.body).toBe('{"a":1}')
  })

  it('turns the reply into a Response', async () => {
    const { net } = fakeNet({
      status: 401,
      headers: { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] },
      body: '{"error":"Unauthorized"}'
    })
    const response = await createNetFetch(net)('https://id.twitch.tv/oauth2/validate', {
      method: 'GET'
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it.each([
    ['HEAD', 200],
    ['GET', 204]
  ])('returns no body for %s %i', async (method, status) => {
    const { net } = fakeNet({ status })
    const response = await createNetFetch(net)('https://x', { method })
    expect(response.status).toBe(status)
    expect(await response.text()).toBe('')
  })

  it('aborts the request when the signal fires', async () => {
    const { net, sent } = fakeNet({ hang: true })
    const controller = new AbortController()
    const pending = createNetFetch(net)('https://x', { method: 'GET', signal: controller.signal })
    controller.abort(new DOMException('timed out', 'TimeoutError'))
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(sent.aborted).toBe(true)
  })

  it('rejects on network errors', async () => {
    const { net } = fakeNet({ error: new Error('net::ERR_CONNECTION_REFUSED') })
    await expect(createNetFetch(net)('https://x', { method: 'GET' })).rejects.toThrow(
      'ERR_CONNECTION_REFUSED'
    )
  })
})

describe('proxy and timeouts', () => {
  it.each([
    ['', { mode: 'system' }],
    ['http://127.0.0.1:8080', { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:8080' }],
    ['https://proxy.example/', { mode: 'fixed_servers', proxyRules: 'https://proxy.example' }],
    [
      'socks5://user:pw@10.0.0.1:1080',
      { mode: 'fixed_servers', proxyRules: 'socks5://10.0.0.1:1080' }
    ]
  ])('maps the proxy setting %j', async (proxy, expected) => {
    expect(proxyConfig(proxy)).toEqual(expected)
    const setProxy = vi.fn(async () => {})
    await applyProxy({ setProxy }, proxy)
    expect(setProxy).toHaveBeenCalledWith(expected)
  })

  it('scales timeouts with connection quality', () => {
    expect([1, 3, 6].map(requestTimeoutMs)).toEqual([10_000, 30_000, 60_000])
  })
})
