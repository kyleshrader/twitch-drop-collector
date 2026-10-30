// Network adapters for @tdc/api: Electron's net stack (system proxy and certificate store) and
// the proxy setting applied to the session it uses.
import type { Net, Session } from 'electron'
import type { FetchLike } from '@tdc/api'

/**
 * FetchLike over net.request. Not net.fetch: net.fetch refuses a custom Origin
 * (net::ERR_FAILED) or Referer (net::ERR_BLOCKED_BY_CLIENT), and Twitch's clients send both.
 * net.request accepts Origin as the `origin` option, and Referer once the referrer policy
 * allows it. Session cookies are not sent (`useSessionCookies` defaults to false).
 */
export function createNetFetch(net: Pick<Net, 'request'>): FetchLike {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined
      if (signal?.aborted) return reject(signal.reason)

      const headers = new Headers(init.headers)
      const origin = headers.get('origin') ?? undefined
      const referer = headers.get('referer') ?? undefined
      headers.delete('origin')
      headers.delete('referer')

      const request = net.request({
        method: init.method ?? 'GET',
        url,
        redirect: 'follow',
        ...(origin ? { origin } : {}),
        ...(referer ? { referrerPolicy: 'unsafe-url' as const } : {})
      })
      headers.forEach((value, name) => request.setHeader(name, value))
      if (referer) request.setHeader('Referer', referer)

      const onAbort = (): void => {
        request.abort()
        reject(signal?.reason)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const done = (): void => signal?.removeEventListener('abort', onAbort)

      request.on('response', (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('error', (error: Error) => {
          done()
          reject(error)
        })
        response.on('end', () => {
          done()
          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(response.headers)) {
            for (const item of Array.isArray(value) ? value : [value]) {
              responseHeaders.append(name, item)
            }
          }
          const status = response.statusCode
          // Response refuses a body for these statuses.
          const nullBody = init.method === 'HEAD' || [101, 204, 205, 304].includes(status)
          resolve(
            new Response(nullBody ? null : Buffer.concat(chunks), {
              status,
              statusText: response.statusMessage,
              headers: responseHeaders
            })
          )
        })
      })
      request.on('error', (error) => {
        done()
        reject(error)
      })

      const body = init.body
      if (body === undefined || body === null) request.end()
      else if (typeof body === 'string') request.end(body)
      else reject(new TypeError('createNetFetch only supports string bodies'))
    })
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
