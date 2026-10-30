import { createBackoff, type Logger, type RateLimiter, type Scheduler } from '@tdc/kernel'
import { GqlError, ResponseShapeError } from '../errors'
import type { HttpClient } from '../http'
import { toPayload, type GqlOperation } from './operation'

/**
 * Who the request is from: the session's client identity (Client-Id, Origin, Referer,
 * User-Agent) plus Authorization and the device and session IDs. Implemented by auth.
 */
export interface GqlAuth {
  headers(): Promise<Record<string, string>>
}

export interface GqlClient {
  request<V, D>(operation: GqlOperation<V, D>, input: V, signal?: AbortSignal): Promise<D>
  /** One result per input, in order. Sent as batches of up to 20 per HTTP request. */
  batch<V, D>(
    operation: GqlOperation<V, D>,
    inputs: readonly V[],
    signal?: AbortSignal
  ): Promise<D[]>
}

export const GQL_BATCH_SIZE = 20

// Error messages from Twitch's GQL gateway, and what to do about them.
const RETRY_ONCE = new Set(['service error', 'PersistedQueryNotFound'])
const RETRY_WITH_BACKOFF = new Set([
  'service timeout',
  'request cancelled',
  'service unavailable',
  'context deadline exceeded'
])

interface GqlItem {
  data?: unknown
  errors?: { message?: string; path?: (string | number)[] }[]
  error?: string
  message?: string
}

type Verdict = { kind: 'ok' } | { kind: 'retry'; once: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Applies Twitch's error conventions to one response item; may null out a failed path. */
function inspect(operation: string, item: GqlItem): Verdict {
  if (item.error) throw new GqlError(operation, `${item.error}: ${item.message ?? ''}`, item)
  for (const error of item.errors ?? []) {
    const message = error.message ?? ''
    if (RETRY_ONCE.has(message)) return { kind: 'retry', once: true }
    if (RETRY_WITH_BACKOFF.has(message)) return { kind: 'retry', once: false }
    if (message === 'server error' && error.path?.length && isRecord(item.data)) {
      // Twitch failed to resolve one field: treat it as missing and keep the rest.
      let parent: unknown = item.data
      for (const key of error.path.slice(0, -1)) parent = isRecord(parent) ? parent[key] : undefined
      if (isRecord(parent)) parent[error.path.at(-1)!] = null
      continue
    }
    throw new GqlError(operation, message || 'unknown error', item.errors)
  }
  return { kind: 'ok' }
}

export function createGqlClient(deps: {
  http: HttpClient
  auth: GqlAuth
  url: string
  limiter: RateLimiter
  scheduler: Scheduler
  logger: Logger
  maxAttempts?: number
  random?: () => number
}): GqlClient {
  const { http, auth, url, limiter, scheduler, logger, maxAttempts = 8 } = deps

  const send = async <V, D>(
    operation: GqlOperation<V, D>,
    inputs: readonly V[],
    batched: boolean,
    signal?: AbortSignal
  ): Promise<D[]> => {
    const payload = inputs.map((input) => toPayload(operation, input))
    const backoff = createBackoff({ maxMs: 60_000, random: deps.random })
    let retriedOnce = false

    for (let attempt = 1; ; attempt++) {
      const response = await limiter.run(async () =>
        http.request({
          method: 'POST',
          url,
          signal,
          json: batched ? payload : payload[0],
          headers: { Accept: '*/*', ...(await auth.headers()) }
        })
      )
      if (response.status !== 200) {
        throw new GqlError(operation.name, `HTTP ${response.status}`, response.text)
      }

      let body: unknown
      try {
        body = JSON.parse(response.text)
      } catch {
        throw new ResponseShapeError(operation.name, ['response is not JSON'])
      }
      const items = (Array.isArray(body) ? body : [body]) as GqlItem[]
      if (items.length !== inputs.length || items.some((item) => !isRecord(item))) {
        throw new ResponseShapeError(operation.name, [
          `expected ${inputs.length} result(s), got ${items.length}`
        ])
      }

      const verdicts = items.map((item) => inspect(operation.name, item))
      const retry = verdicts.find((v) => v.kind === 'retry')
      if (!retry) {
        return items.map((item) => {
          const parsed = operation.data.safeParse(item.data)
          if (!parsed.success) {
            throw new ResponseShapeError(
              operation.name,
              parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
            )
          }
          return parsed.data
        })
      }

      if (retry.kind === 'retry' && retry.once) {
        if (retriedOnce) throw new GqlError(operation.name, 'failed again after a retry', items)
        retriedOnce = true
      }
      if (attempt >= maxAttempts) throw new GqlError(operation.name, 'too many retries', items)
      // "service error" style failures need a real pause before Twitch recovers.
      const delay = Math.max(backoff.next(), retry.kind === 'retry' && retry.once ? 5000 : 0)
      logger.warn('GQL request failed; retrying', { operation: operation.name, retryInMs: delay })
      await scheduler.sleep(delay, signal)
    }
  }

  return {
    async request(operation, input, signal) {
      const [result] = await send(operation, [input], false, signal)
      return result!
    },
    async batch(operation, inputs, signal) {
      const chunks: (typeof inputs)[] = []
      for (let i = 0; i < inputs.length; i += GQL_BATCH_SIZE) {
        chunks.push(inputs.slice(i, i + GQL_BATCH_SIZE))
      }
      const results = await Promise.all(chunks.map((chunk) => send(operation, chunk, true, signal)))
      return results.flat()
    }
  }
}
