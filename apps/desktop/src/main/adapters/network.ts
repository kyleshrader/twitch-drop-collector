// Network adapters for @tdc/api: Electron's net.fetch (system proxy and certificate store) and
// the proxy setting applied to the session net.fetch uses.
import type { Net, Session } from 'electron'
import type { FetchLike } from '@tdc/api'

export function createNetFetch(net: Pick<Net, 'fetch'>): FetchLike {
  return (url, init) => net.fetch(url, init)
}

/**
 * Turns the proxy setting into Electron proxy config. Empty means "use the system proxy".
 * Electron's proxyRules take scheme://host:port; credentials in the URL aren't supported.
 */
export function proxyConfig(proxy: string): Electron.ProxyConfig {
  if (proxy === '') return { mode: 'system' }
  const url = new URL(proxy)
  return { mode: 'fixed_servers', proxyRules: `${url.protocol}//${url.host}` }
}

export async function applyProxy(session: Pick<Session, 'setProxy'>, proxy: string): Promise<void> {
  await session.setProxy(proxyConfig(proxy))
}

/** Per-attempt request timeout: 10s at connection quality 1, up to 60s at 6 (as upstream). */
export function requestTimeoutMs(connectionQuality: number): number {
  return 10_000 * connectionQuality
}
