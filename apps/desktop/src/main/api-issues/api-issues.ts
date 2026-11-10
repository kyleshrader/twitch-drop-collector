// The app's record of signs that Twitch changed its API (packages/api/src/monitor.ts finds them).
// Each kind of mismatch is one issue, counted as it repeats. Issues are saved, so they survive a
// restart, and written to a log file of their own with what was expected and what came back.
// Everything is redacted before it's kept (redact.ts).
import type { ApiIssue, ApiMonitor } from '@tdc/api'
import type { ApiIssuesView, ApiIssueView } from '@tdc/ipc-contract'
import { ApiIssueView as ApiIssueSchema } from '@tdc/ipc-contract'
import type { Clock, Logger } from '@tdc/kernel'
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** Kept at most; the ones seen longest ago go first. */
export const MAX_ISSUES = 200
/** A repeat is written to the log again only this long after the last time it was. */
export const LOG_REPEAT_MS = 60 * 60 * 1000
/** A dismissed issue comes back if it happens again this long after it was dismissed. */
export const DISMISS_FOR_MS = 24 * 60 * 60 * 1000
/** Saving waits this long for more changes. */
const SAVE_DELAY_MS = 1000

export const API_LOG_FILE = 'twitch-api.log'
/** At most one desktop notification about API issues this often. */
export const API_NOTICE_EVERY_MS = 30 * 60 * 1000

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "2 errors and 1 warning" */
export function countsText(errors: number, warnings: number): string {
  const parts = [
    errors > 0 ? plural(errors, 'error', 'errors') : '',
    warnings > 0 ? plural(warnings, 'warning', 'warnings') : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' and ') : 'No issues'
}

/** Identity responses are about the user's own session: keep their shape, none of their text. */
function blankText(value: unknown): unknown {
  if (typeof value === 'string') return '[redacted]'
  if (typeof value === 'number') return 0
  if (Array.isArray(value)) return value.map(blankText)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blankText(v)]))
}

const Saved = z.object({
  version: z.literal(1),
  issues: z.array(
    ApiIssueSchema.extend({
      dismissedAt: z.string().optional(),
      loggedAt: z.string().optional()
    })
  )
})
type Entry = z.infer<typeof Saved>['issues'][number]

export interface ApiIssueLog extends ApiMonitor {
  /** Reads the saved issues; reports before this finishes are kept too. */
  load(): Promise<void>
  view(): ApiIssuesView
  get(id: string): ApiIssueView | undefined
  /** Hides one issue, or all of them. */
  dismiss(id?: string): void
  onChange(listener: () => void): () => void
  /** Writes pending changes now (on quit). */
  flush(): Promise<void>
}

/** Same kind of mismatch at the same places: one issue. Array indexes don't matter. */
export function issueId(issue: Pick<ApiIssue, 'source' | 'endpoint' | 'kind' | 'checks'>): string {
  const places = issue.checks
    .map((c) => `${c.path.replace(/\.\d+(?=\.|$)/g, '.*')}:${c.message}`)
    .sort()
    .join('|')
  return createHash('sha256')
    .update(`${issue.source}|${issue.endpoint}|${issue.kind}|${places}`)
    .digest('hex')
    .slice(0, 16)
}

export function createApiIssueLog(deps: {
  store: { read(): Promise<unknown>; write(data: unknown): Promise<void> }
  /** Appends one line to the API log file (the caller rotates it). */
  appendLog: (line: string) => Promise<void>
  redact: (value: unknown) => unknown
  clock: Clock
  logger: Logger
  /** An issue showed up that wasn't showing: new, or back after being dismissed. */
  onNew?: (issue: ApiIssue) => void
}): ApiIssueLog {
  const { store, appendLog, redact, clock, logger } = deps
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> = Promise.resolve()

  const changed = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        logger.error('API issue listener failed', { error })
      }
    }
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void save()
    }, SAVE_DELAY_MS)
    saveTimer.unref?.()
  }

  const save = (): Promise<void> => {
    const data = { version: 1, issues: [...entries.values()] }
    writing = writing
      .then(() => store.write(data))
      .catch((error: unknown) => logger.warn('Could not save API issues', { error }))
    return writing
  }

  const writeLog = (entry: Entry, at: string): void => {
    const line = JSON.stringify({
      at,
      severity: entry.severity,
      source: entry.source,
      endpoint: entry.endpoint,
      kind: entry.kind,
      ...(entry.demo ? { demo: true } : {}),
      summary: entry.summary,
      count: entry.count,
      checks: entry.checks,
      response: entry.response
    })
    appendLog(`${line}\n`).catch((error: unknown) =>
      logger.warn('Could not write the API log', { error })
    )
  }

  const toView = (entry: Entry): ApiIssueView => {
    const view = { ...entry }
    delete view.dismissedAt
    delete view.loggedAt
    return view
  }
  const visible = (): Entry[] =>
    [...entries.values()]
      .filter((e) => e.dismissedAt === undefined)
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  const prune = (): void => {
    if (entries.size <= MAX_ISSUES) return
    const oldest = [...entries.values()].sort((a, b) => a.lastAt.localeCompare(b.lastAt))
    for (const e of oldest.slice(0, entries.size - MAX_ISSUES)) entries.delete(e.id)
  }

  return {
    report(issue) {
      const now = clock.now()
      const at = now.toISOString()
      const id = issueId(issue)
      const clean = (value: unknown): unknown =>
        redact(issue.source === 'identity' ? blankText(value) : value)
      const checks = issue.checks.map((c) => ({
        path: c.path,
        message: String(redact(c.message)),
        ...(c.expected !== undefined ? { expected: c.expected } : {}),
        ...(c.actual !== undefined ? { actual: clean(c.actual) } : {}),
        ...(c.missing ? { missing: true } : {})
      }))
      const known = entries.get(id)
      let shown: boolean
      let entry: Entry
      if (known) {
        // A demo always comes back, so it can be tried again right away.
        const back =
          known.dismissedAt !== undefined &&
          (issue.demo === true || now.getTime() - Date.parse(known.dismissedAt) >= DISMISS_FOR_MS)
        const { dismissedAt, ...rest } = known
        entry = {
          ...rest,
          ...(dismissedAt !== undefined && !back ? { dismissedAt } : {}),
          severity: known.severity === 'error' ? 'error' : issue.severity,
          summary: String(redact(issue.summary)),
          checks,
          ...(issue.response !== undefined ? { response: clean(issue.response) } : {}),
          lastAt: at,
          count: known.count + 1
        }
        shown = back
      } else {
        entry = {
          id,
          severity: issue.severity,
          source: issue.source,
          endpoint: issue.endpoint,
          kind: issue.kind,
          summary: String(redact(issue.summary)),
          checks,
          ...(issue.response !== undefined ? { response: clean(issue.response) } : {}),
          firstAt: at,
          lastAt: at,
          count: 1,
          ...(issue.demo ? { demo: true } : {})
        }
        shown = true
      }
      const logDue =
        entry.loggedAt === undefined || now.getTime() - Date.parse(entry.loggedAt) >= LOG_REPEAT_MS
      if (logDue) {
        entry.loggedAt = at
        writeLog(entry, at)
      }
      entries.set(id, entry)
      prune()
      if (shown) {
        logger.warn('Twitch API mismatch', {
          endpoint: entry.endpoint,
          kind: entry.kind,
          severity: entry.severity
        })
      }
      changed()
      if (shown) deps.onNew?.(issue)
    },

    async load() {
      let raw: unknown
      try {
        raw = await store.read()
      } catch (error) {
        logger.warn('Could not read saved API issues', { error })
        return
      }
      if (raw === undefined) return
      const parsed = Saved.safeParse(raw)
      if (!parsed.success) {
        logger.warn('Saved API issues are unreadable; starting over')
        return
      }
      // Reports that came in while loading win over the saved copies.
      for (const e of parsed.data.issues) if (!entries.has(e.id)) entries.set(e.id, e)
      prune()
      changed()
    },

    view() {
      const issues = visible()
      return {
        issues: issues.map(toView),
        errors: issues.filter((e) => e.severity === 'error').length,
        warnings: issues.filter((e) => e.severity === 'warning').length,
        logFile: API_LOG_FILE
      }
    },

    get(id) {
      const entry = entries.get(id)
      return entry ? toView(entry) : undefined
    },

    dismiss(id) {
      const at = clock.now().toISOString()
      for (const entry of entries.values()) {
        if ((id === undefined || entry.id === id) && entry.dismissedAt === undefined) {
          entry.dismissedAt = at
        }
      }
      changed()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = undefined
        await save()
      }
      await writing
    }
  }
}
