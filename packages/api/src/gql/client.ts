import { createBackoff, type Logger, type RateLimiter, type Scheduler } from '@tdc/kernel'
import { GqlError, ResponseShapeError } from '../errors'
import type { HttpClient } from '../http'
import { checkShape, safely, type ApiIssue, type ApiMonitor } from '../monitor'
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
type Report = (issue: Omit<ApiIssue, 'source' | 'endpoint'>) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Applies Twitch's error conventions to one response item; may null out a failed path. */
function inspect(operation: string, item: GqlItem, report: Report): Verdict {
  if (item.error) {
    report({
      severity: 'error',
      kind: 'error',
      summary: `Twitch returned an error: ${item.error}`,
      checks: [
        { path: 'error', message: item.message ?? item.error, expected: 'no error', actual: item }
      ],
      response: item
    })
    throw new GqlError(operation, `${item.error}: ${item.message ?? ''}`, item)
  }
  for (const error of item.errors ?? []) {
    const message = error.message ?? ''
    if (RETRY_ONCE.has(message)) return { kind: 'retry', once: true }
    if (RETRY_WITH_BACKOFF.has(message)) return { kind: 'retry', once: false }
    if (message === 'server error' && error.path?.length && isRecord(item.data)) {
      // Twitch failed to resolve one field: treat it as missing and keep the rest.
      let parent: unknown = item.data
      for (const key of error.path.slice(0, -1)) parent = isRecord(parent) ? parent[key] : undefined
      if (isRecord(parent)) parent[error.path.at(-1)!] = null
      report({
        severity: 'warning',
        kind: 'partial',
        summary: `Twitch couldn’t resolve ${error.path.join('.')}, so the app carried on without it`,
        checks: [{ path: error.path.join('.'), message, expected: 'a value', actual: error }],
        response: item.errors
      })
      continue
    }
    const known = message || 'unknown error'
    report({
      severity: 'error',
      kind: 'error',
      summary: `Twitch returned an error the app doesn’t know: ${known}`,
      checks: [
        {
          path: error.path?.join('.') ?? 'errors',
          message: known,
          expected: 'no error, or one of the passing errors we retry',
          actual: error
        }
      ],
      response: item.errors
    })
    throw new GqlError(operation, known, item.errors)
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
  /** Told about responses that suggest Twitch changed its API. */
  monitor?: ApiMonitor
}): GqlClient {
  const { http, auth, url, limiter, scheduler, logger, maxAttempts = 8 } = deps
  const monitor = safely(deps.monitor)

  const send = async <V, D>(
    operation: GqlOperation<V, D>,
    inputs: readonly V[],
    batched: boolean,
    signal?: AbortSignal
  ): Promise<D[]> => {
    const payload = inputs.map((input) => toPayload(operation, input))
    const backoff = createBackoff({ maxMs: 60_000, random: deps.random })
    let retriedOnce = false
    const report: Report = (issue) =>
      monitor?.report({ ...issue, source: 'gql', endpoint: operation.name })

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
        // 401: the session ended; 429: too many requests. Neither says the API changed.
        if (response.status !== 401 && response.status !== 429) {
          report({
            severity: response.status >= 500 ? 'warning' : 'error',
            kind: 'http',
            summary: `Twitch answered HTTP ${response.status}`,
            checks: [
              {
                path: 'status',
                message: 'unexpected HTTP status',
                expected: 200,
                actual: response.status
              }
            ],
            response: response.text.slice(0, 2000)
          })
        }
        throw new GqlError(operation.name, `HTTP ${response.status}`, response.text)
      }

      let body: unknown
      try {
        body = JSON.parse(response.text)
      } catch {
        report({
          severity: 'error',
          kind: 'shape',
          summary: 'The response isn’t JSON',
          checks: [
            {
              path: '(root)',
              message: 'response is not JSON',
              expected: 'JSON',
              actual: response.text.slice(0, 2000)
            }
          ]
        })
        throw new ResponseShapeError(operation.name, ['response is not JSON'])
      }
      const items = (Array.isArray(body) ? body : [body]) as GqlItem[]
      if (items.length !== inputs.length || items.some((item) => !isRecord(item))) {
        report({
          severity: 'error',
          kind: 'shape',
          summary: `Expected ${inputs.length} ${inputs.length === 1 ? 'result' : 'results'}, got ${items.length}`,
          checks: [
            {
              path: '(root)',
              message: 'wrong number of results',
              expected: inputs.length,
              actual: items.length
            }
          ],
          response: body
        })
        throw new ResponseShapeError(operation.name, [
          `expected ${inputs.length} result(s), got ${items.length}`
        ])
      }

      const verdicts = items.map((item) => inspect(operation.name, item, report))
      const retry = verdicts.find((v) => v.kind === 'retry')
      if (!retry) {
        return items.map((item) => {
          const parsed = checkShape(monitor, 'gql', operation.name, operation.data, item.data)
          if (!parsed.success) {
            throw new ResponseShapeError(
              operation.name,
              parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
            )
          }
          return parsed.data
        })
      }

      const errors = items.flatMap((item) => item.errors ?? [])
      if (retry.kind === 'retry' && retry.once) {
        if (retriedOnce) {
          report({
            severity: 'error',
            kind: 'retried',
            summary: 'Still failing after a retry',
            checks: [
              { path: 'errors', message: 'failed again', expected: 'no errors', actual: errors }
            ],
            response: errors
          })
          throw new GqlError(operation.name, 'failed again after a retry', items)
        }
        // Twitch no longer knows the persisted query: its hash is probably outdated.
        if (errors.some((e) => e.message === 'PersistedQueryNotFound')) {
          report({
            severity: 'warning',
            kind: 'retried',
            summary: 'Twitch didn’t recognise the query (PersistedQueryNotFound)',
            checks: [
              {
                path: 'errors',
                message: 'PersistedQueryNotFound',
                expected: 'a persisted query Twitch knows',
                actual: errors
              }
            ],
            response: errors
          })
        }
        retriedOnce = true
      }
      if (attempt >= maxAttempts) {
        report({
          severity: 'warning',
          kind: 'retried',
          summary: `Gave up after ${attempt} attempts`,
          checks: [
            {
              path: 'errors',
              message: 'too many retries',
              expected: 'a response without errors',
              actual: errors
            }
          ],
          response: errors
        })
        throw new GqlError(operation.name, 'too many retries', items)
      }
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
