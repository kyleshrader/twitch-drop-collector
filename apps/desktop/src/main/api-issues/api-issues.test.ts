import type { ApiIssue } from '@tdc/api'
import type { Logger } from '@tdc/kernel'
import { describe, expect, it, vi } from 'vitest'
import {
  countsText,
  createApiIssueLog,
  DISMISS_FOR_MS,
  issueId,
  LOG_REPEAT_MS,
  MAX_ISSUES
} from './api-issues'
import { demoIssue } from './demo'
import { createRedactor, REDACTED, YOU } from './redact'
import { reportBody, reportUrl, MAX_BODY } from './report'

const logger: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => logger
}

const shape = (overrides: Partial<ApiIssue> = {}): ApiIssue => ({
  severity: 'error',
  source: 'gql',
  endpoint: 'Inventory',
  kind: 'shape',
  summary: 'The response doesn’t match what we expect (1 difference)',
  checks: [
    {
      path: 'currentUser.inventory.dropCampaignsInProgress.0.id',
      message: 'Invalid input: expected string, received number',
      expected: { type: 'string' },
      actual: 42
    }
  ],
  response: { currentUser: { id: '1234567', login: 'someviewer' } },
  ...overrides
})

function setup(saved?: unknown): {
  log: ReturnType<typeof createApiIssueLog>
  lines: string[]
  writes: unknown[]
  clock: { now: () => Date; advance: (ms: number) => void }
  onNew: ReturnType<typeof vi.fn>
} {
  let now = Date.parse('2026-11-09T12:00:00Z')
  const clock = { now: () => new Date(now), advance: (ms: number) => (now += ms) }
  const lines: string[] = []
  const writes: unknown[] = []
  const onNew = vi.fn()
  const log = createApiIssueLog({
    store: { read: async () => saved, write: async (data) => void writes.push(data) },
    appendLog: async (line) => void lines.push(line),
    redact: createRedactor(() => ['1234567', 'someviewer']),
    clock,
    logger,
    onNew
  })
  return { log, lines, writes, clock, onNew }
}

describe('API issue log', () => {
  it('counts a repeat of the same mismatch as one issue, whatever the array index', () => {
    const { log, onNew, clock } = setup()
    log.report(shape())
    clock.advance(1000)
    log.report(
      shape({
        checks: [
          { ...shape().checks[0]!, path: 'currentUser.inventory.dropCampaignsInProgress.3.id' }
        ]
      })
    )
    clock.advance(1000)
    log.report(shape({ endpoint: 'ViewerDropsDashboard' }))

    const view = log.view()
    expect(view.issues.map((i) => [i.endpoint, i.count])).toEqual([
      ['ViewerDropsDashboard', 1],
      ['Inventory', 2]
    ])
    expect(view).toMatchObject({ errors: 2, warnings: 0, logFile: 'twitch-api.log' })
    // Notified for each issue that started showing, not for the repeat.
    expect(onNew).toHaveBeenCalledTimes(2)
  })

  it('writes expected and actual to its own log, a repeat again only after an hour', () => {
    const { log, lines, clock } = setup()
    log.report(shape())
    log.report(shape())
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(line).toMatchObject({
      endpoint: 'Inventory',
      severity: 'error',
      checks: [{ expected: { type: 'string' }, actual: 42 }]
    })
    clock.advance(LOG_REPEAT_MS)
    log.report(shape())
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({ count: 3 })
  })

  it('never keeps the user’s ID or login', () => {
    const { log, lines } = setup()
    log.report(shape({ summary: 'failed for someviewer' }))
    const kept = JSON.stringify(log.view()) + lines.join('')
    expect(kept).not.toMatch(/1234567|someviewer/)
    expect(kept).toContain(YOU)
  })

  it('blanks every value of a sign-in response, keeping its shape', () => {
    const { log } = setup()
    log.report(
      shape({
        source: 'identity',
        endpoint: 'validate',
        response: { login: 'anyone', user_id: '999', expires_in: 100 }
      })
    )
    expect(log.view().issues[0]!.response).toEqual({
      login: REDACTED,
      user_id: REDACTED,
      expires_in: 0
    })
  })

  it('hides a dismissed issue until it happens again a day later', () => {
    const { log, clock, onNew } = setup()
    log.report(shape())
    log.report(shape({ endpoint: 'Other' }))
    log.dismiss(issueId(shape()))
    expect(log.view().issues.map((i) => i.endpoint)).toEqual(['Other'])

    log.report(shape())
    expect(log.view().issues).toHaveLength(1)
    clock.advance(DISMISS_FOR_MS)
    log.report(shape())
    expect(log.view().issues).toHaveLength(2)
    expect(onNew).toHaveBeenCalledTimes(3)

    log.dismiss()
    expect(log.view()).toMatchObject({ issues: [], errors: 0, warnings: 0 })
  })

  it('saves issues and loads them back, keeping reports that came in first', async () => {
    const first = setup()
    first.log.report(shape())
    first.log.dismiss(issueId(shape()))
    first.log.report(shape({ endpoint: 'Kept', severity: 'warning' }))
    await first.log.flush()
    const saved = first.writes.at(-1)

    const second = setup(saved)
    second.log.report(shape({ endpoint: 'Early' }))
    await second.log.load()
    expect(
      second.log
        .view()
        .issues.map((i) => i.endpoint)
        .sort()
    ).toEqual(['Early', 'Kept'])
    expect(second.log.view()).toMatchObject({ errors: 1, warnings: 1 })
  })

  it('ignores a saved file it can’t read, and keeps at most MAX_ISSUES', async () => {
    const { log, clock } = setup({ version: 9 })
    await log.load()
    expect(log.view().issues).toEqual([])
    for (let i = 0; i < MAX_ISSUES + 5; i++) {
      clock.advance(1000)
      log.report(shape({ endpoint: `Op${i}` }))
    }
    const kept = log.view().issues
    expect(kept).toHaveLength(MAX_ISSUES)
    expect(kept.at(-1)!.endpoint).toBe('Op5')
  })

  it('says how many errors and warnings there are', () => {
    expect(countsText(2, 1)).toBe('2 errors and 1 warning')
    expect(countsText(0, 3)).toBe('3 warnings')
    expect(countsText(0, 0)).toBe('No problems')
  })
})

describe('redaction', () => {
  const redact = createRedactor(() => ['1234567', 'SomeViewer'])

  it('drops secrets and drop instance IDs, and replaces the user’s ID and login', () => {
    expect(
      redact({
        streamPlaybackAccessToken: { value: 'secret', signature: 'sig' },
        self: { dropInstanceID: '1234567#abc', isClaimed: true },
        currentUser: { id: '1234567', login: 'someviewer', numeric: 1234567 },
        channel: { login: 'streamer', missing: null }
      })
    ).toEqual({
      streamPlaybackAccessToken: REDACTED,
      self: { dropInstanceID: REDACTED, isClaimed: true },
      currentUser: { id: YOU, login: YOU, numeric: YOU },
      channel: { login: 'streamer', missing: null }
    })
  })

  it('trims long strings and long lists', () => {
    const out = redact({ text: 'x'.repeat(2000), list: Array.from({ length: 40 }, (_, i) => i) })
    const { text, list } = out as { text: string; list: unknown[] }
    expect(text.length).toBeLessThan(600)
    expect(list).toHaveLength(26)
    expect(list.at(-1)).toBe('… 15 more')
  })
})

describe('GitHub report', () => {
  const issue = {
    ...shape(),
    id: 'abc',
    checks: shape().checks,
    firstAt: '2026-11-09T12:00:00.000Z',
    lastAt: '2026-11-09T13:00:00.000Z',
    count: 2
  }
  const app = { version: '1.2.3', platform: 'win32' }

  it('opens a new issue on the app’s repository with the details filled in', () => {
    const url = new URL(reportUrl(issue, app))
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://github.com/kyleshrader/twitch-drop-collector/issues/new'
    )
    expect(url.searchParams.get('title')).toMatch(/^Twitch API: Inventory: /)
    const body = url.searchParams.get('body')!
    expect(body).toContain('currentUser.inventory.dropCampaignsInProgress.0.id')
    expect(body).toContain('"type": "string"')
    expect(body).toContain('1.2.3 on win32')
  })

  it('keeps the body short enough for a link', () => {
    const big = {
      ...issue,
      checks: Array.from({ length: 50 }, (_, i) => ({
        path: `a.${i}`,
        message: 'changed',
        expected: { type: 'string' },
        actual: 'y'.repeat(400)
      }))
    }
    const body = reportBody(big, app)
    expect(body.length).toBeLessThanOrEqual(MAX_BODY + 200)
    expect(body).toMatch(/left out/)
  })
})

describe('demo issue', () => {
  it('is a real check of a made-up response, marked as a demo', () => {
    const issue = demoIssue()
    expect(issue).toMatchObject({ endpoint: 'UserAvatar', kind: 'shape', demo: true })
    expect(issue.checks).toEqual([
      expect.objectContaining({
        path: 'user.profileImageURL',
        expected: { type: ['string', 'null'] },
        actual: expect.objectContaining({ width: 70 })
      })
    ])
  })

  it('comes back right after being dismissed, so it can be tried again', () => {
    const { log, onNew } = setup()
    log.report(demoIssue())
    log.dismiss()
    log.report(demoIssue())
    expect(log.view().issues).toEqual([expect.objectContaining({ demo: true, count: 2 })])
    expect(onNew).toHaveBeenCalledTimes(2)
  })
})
