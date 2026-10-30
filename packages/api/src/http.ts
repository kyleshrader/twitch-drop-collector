// HTTP for every Twitch call. The fetch implementation is injected: Electron's net.fetch in the
// app (system proxy and certificate store), the global fetch in tests.
import { createBackoff, type Logger, type Scheduler } from '@tdc/kernel'
import { RequestFailedError } from './errors'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpRequest {
  method: 'GET' | 'POST' | 'HEAD'
  url: string
  headers?: Record<string, string>
  /** Sent as a JSON body. */
  json?: unknown
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>
  signal?: AbortSignal
  /** Give up after this many attempts. Default: keep retrying until aborted. */
  maxAttempts?: number
}

export interface HttpResponse {
  status: number
  headers: Headers
  /** The full body, already read. Empty for HEAD. */
  text: string
}

export interface HttpClient {
  /**
   * Retries connection errors, timeouts and 5xx responses with backoff. Any other status is
   * returned to the caller. Rejects with AbortError when the signal aborts.
   */
  request(request: HttpRequest): Promise<HttpResponse>
}

export function createHttpClient(deps: {
  fetch: FetchLike
  userAgent: string
  /** Per-attempt timeout, read on every attempt so setting changes apply immediately. */
  timeoutMs: () => number
  scheduler: Scheduler
  logger: Logger
  /** Backoff ceiling between attempts. Twitch's own clients cap at about 3 minutes. */
  maxBackoffMs?: number
  random?: () => number
}): HttpClient {
  const { fetch, userAgent, timeoutMs, scheduler, logger, maxBackoffMs = 3 * 60_000 } = deps

  const attempt = async (request: HttpRequest): Promise<HttpResponse> => {
    const headers: Record<string, string> = { 'User-Agent': userAgent, ...request.headers }
    let body: string | undefined
    if (request.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(request.json)
    } else if (request.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(request.form).toString()
    }
    const timeout = AbortSignal.timeout(timeoutMs())
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    const response = await fetch(request.url, { method: request.method, headers, body, signal })
    const text = request.method === 'HEAD' ? '' : await response.text()
    return { status: response.status, headers: response.headers, text }
  }

  return {
    async request(request) {
      const { maxAttempts = Number.POSITIVE_INFINITY } = request
      const backoff = createBackoff({ maxMs: maxBackoffMs, random: deps.random })
      let lastError: unknown
      for (let attempts = 1; ; attempts++) {
        request.signal?.throwIfAborted()
        try {
          const response = await attempt(request)
          if (response.status < 500) return response
          lastError = new Error(`HTTP ${response.status}`)
        } catch (error) {
          // A caller abort is final. Anything else (connection error, our own per-attempt
          // timeout) is a failed attempt worth retrying.
          if (request.signal?.aborted) throw request.signal.reason ?? error
          lastError = error
        }
        if (attempts >= maxAttempts) {
          throw new RequestFailedError(request.url, attempts, { cause: lastError })
        }
        const delay = backoff.next()
        logger.warn('Request failed; retrying', {
          url: request.url,
          attempt: attempts,
          retryInMs: Math.round(delay),
          error: lastError instanceof Error ? lastError.message : String(lastError)
        })
        await scheduler.sleep(delay, request.signal)
      }
    }
  }
}
