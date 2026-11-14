// Watches Twitch's responses for signs its API changed: a response that no longer matches our
// schema, an error we don't know, a hash Twitch stopped accepting. Each finding is reported with
// what we expected and what came back, so the app can log it and show it. Reports are raw; the
// app redacts them before they're saved or shown.
import { z } from 'zod'

export type ApiIssueSeverity = 'error' | 'warning'
/** Where it came from: GQL operations, PubSub messages, or the sign-in (identity) endpoints. */
export type ApiSource = 'gql' | 'pubsub' | 'identity'
/**
 * shape: the response didn't match the schema. error: Twitch returned an error we don't know.
 * http: an unexpected HTTP status. partial: Twitch failed one field and we carried on without it.
 * retried: a request only worked after a retry Twitch's API shouldn't need (an outdated hash).
 */
export type ApiIssueKind = 'shape' | 'error' | 'http' | 'partial' | 'retried'

/** One thing that didn't match, at `path` in the response. */
export interface ApiCheck {
  path: string
  message: string
  /** What we expected there: a JSON Schema fragment, or a description. */
  expected?: unknown
  /** What came back there. */
  actual?: unknown
  /** Nothing came back at `path`. */
  missing?: boolean
}

export interface ApiIssue {
  severity: ApiIssueSeverity
  source: ApiSource
  /** The GQL operation name, PubSub topic kind, or identity endpoint. */
  endpoint: string
  kind: ApiIssueKind
  summary: string
  checks: ApiCheck[]
  /** The response (or the part of it this is about), for context. */
  response?: unknown
  /** Made up to try the app's handling (the Twitch API page's "Simulate a change"). */
  demo?: boolean
}

export interface ApiMonitor {
  report(issue: ApiIssue): void
}

/** For callers that don't watch (tests, the dev probe). */
export const ignoreApiIssues: ApiMonitor = { report: () => {} }

type JsonSchema = Record<string, unknown>
const schemas = new WeakMap<z.ZodType, JsonSchema | null>()

function jsonSchemaOf(schema: z.ZodType): JsonSchema | null {
  if (schemas.has(schema)) return schemas.get(schema) ?? null
  let json: JsonSchema | null
  try {
    json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema
  } catch {
    json = null
  }
  schemas.set(schema, json)
  return json
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The schema for one step down: a property of an object, or an item of an array. */
function step(node: JsonSchema, key: PropertyKey): JsonSchema | undefined {
  const options = [
    node,
    ...((node['anyOf'] ?? node['oneOf'] ?? []) as JsonSchema[]),
    ...((node['allOf'] ?? []) as JsonSchema[])
  ]
  for (const option of options) {
    if (typeof key === 'number' && isRecord(option['items'])) return option['items'] as JsonSchema
    const properties = option['properties']
    if (typeof key === 'string' && isRecord(properties) && isRecord(properties[key])) {
      return properties[key] as JsonSchema
    }
  }
  return undefined
}

/** Without the JSON Schema bookkeeping that says nothing to a reader. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy)
  if (!isRecord(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    // Loose objects allow any extra field: true of every object here, so it says nothing.
    if (key === '$schema' || key === 'additionalProperties') continue
    out[key] = tidy(value)
  }
  return out
}

function at(value: unknown, path: readonly PropertyKey[]): { found: boolean; value?: unknown } {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return { found: false }
    const next = (current as Record<PropertyKey, unknown>)[key]
    if (next === undefined && !Object.hasOwn(current, key)) return { found: false }
    current = next
  }
  return { found: true, value: current }
}

export const pathText = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '(root)' : path.map((k) => String(k)).join('.')

/** What didn't match `schema` in `value`, with the expected schema and the actual value. */
export function shapeChecks(schema: z.ZodType, value: unknown, error: z.ZodError): ApiCheck[] {
  const root = jsonSchemaOf(schema)
  return error.issues.map((issue) => {
    let node: JsonSchema | undefined = root ?? undefined
    for (const key of issue.path) node = node ? step(node, key) : undefined
    const found = at(value, issue.path)
    const described =
      'expected' in issue && typeof issue.expected === 'string' ? issue.expected : undefined
    return {
      path: pathText(issue.path),
      message: issue.message,
      ...(node ? { expected: tidy(node) } : described ? { expected: described } : {}),
      ...(found.found ? { actual: found.value } : { missing: true })
    }
  })
}

/** Checks `value` against `schema`; reports a shape issue when it doesn't match. */
export function checkShape<T>(
  monitor: ApiMonitor | undefined,
  source: ApiSource,
  endpoint: string,
  schema: z.ZodType<T>,
  value: unknown
): z.ZodSafeParseResult<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success && monitor) {
    const checks = shapeChecks(schema, value, parsed.error)
    monitor.report({
      severity: 'error',
      source,
      endpoint,
      kind: 'shape',
      summary: `The response doesn’t match what the app expects (${checks.length} ${
        checks.length === 1 ? 'difference' : 'differences'
      })`,
      checks,
      response: value
    })
  }
  return parsed
}

/** A report must never break the request it's about. */
export function safely(monitor: ApiMonitor | undefined): ApiMonitor | undefined {
  if (!monitor) return undefined
  return {
    report(issue) {
      try {
        monitor.report(issue)
      } catch {
        // Ignored: watching is best-effort.
      }
    }
  }
}
