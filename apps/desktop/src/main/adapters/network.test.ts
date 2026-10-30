import { describe, expect, it, vi } from 'vitest'
import { applyProxy, createNetFetch, proxyConfig, requestTimeoutMs } from './network'

describe('network adapters', () => {
  it('passes requests straight to net.fetch', async () => {
    const response = new Response('ok')
    const fetch = vi.fn(async () => response)
    const init = { method: 'POST', headers: { 'User-Agent': 'x' } }
    expect(await createNetFetch({ fetch })('https://gql.twitch.tv/gql', init)).toBe(response)
    expect(fetch).toHaveBeenCalledWith('https://gql.twitch.tv/gql', init)
  })

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
