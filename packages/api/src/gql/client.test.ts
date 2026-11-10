import { createRateLimiter, systemClock } from '@tdc/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GqlError, ResponseShapeError } from '../errors'
import type { ApiIssue } from '../monitor'
import { createHttpClient } from '../http'
import { CLIENT_PROFILES } from '../profiles'
import {
  recordingScheduler,
  startMockServer,
  testLogger,
  type MockServer
} from '../test/mock-server'
import { createGqlClient, type GqlClient } from './client'
import { CampaignDetailsQuery, CurrentDrop, SearchGames, StreamInfo } from './operations'

let server: MockServer
beforeEach(async () => {
  server = await startMockServer()
})
afterEach(async () => {
  await server.close()
})

function client(issues?: ApiIssue[]): {
  gql: GqlClient
  scheduler: ReturnType<typeof recordingScheduler>
} {
  const scheduler = recordingScheduler()
  const logger = testLogger()
  const http = createHttpClient({
    fetch: (url, init) => fetch(url, init),
    userAgent: 'tdc-test',
    timeoutMs: () => 2000,
    scheduler,
    logger
  })
  const gql = createGqlClient({
    http,
    auth: {
      headers: async () => ({
        Authorization: 'OAuth test-token',
        'Client-Id': CLIENT_PROFILES.androidApp.clientId,
        Origin: CLIENT_PROFILES.androidApp.clientUrl
      })
    },
    url: `${server.url}/gql`,
    limiter: createRateLimiter({
      capacity: 5,
      windowMs: 1000,
      clock: systemClock,
      scheduler: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }
    }),
    scheduler,
    logger,
    random: () => 0.5,
    ...(issues ? { monitor: { report: (issue: ApiIssue) => issues.push(issue) } } : {})
  })
  return { gql, scheduler }
}

const liveStream = (login: string): object => ({
  data: {
    user: {
      id: `id-${login}`,
      login,
      displayName: login.toUpperCase(),
      stream: { id: `stream-${login}`, viewersCount: 42 },
      broadcastSettings: { title: 'hi', game: { id: '1', displayName: 'Rust' } }
    }
  }
})

describe('gql client', () => {
  it('sends a persisted query with auth and client headers, and parses the result', async () => {
    server.handle(() => ({ body: liveStream('foo') }))
    const result = await client().gql.request(StreamInfo, { login: 'foo' })

    expect(result.user?.stream?.viewersCount).toBe(42)
    const sent = server.requests[0]!
    expect(sent.headers['authorization']).toBe('OAuth test-token')
    expect(sent.headers['client-id']).toBe(CLIENT_PROFILES.androidApp.clientId)
    expect(sent.headers['origin']).toBe('https://www.twitch.tv')
    expect(JSON.parse(sent.body)).toEqual({
      operationName: 'VideoPlayerStreamInfoOverlayChannel',
      extensions: { persistedQuery: { version: 1, sha256Hash: StreamInfo.sha256 } },
      variables: { channel: 'foo' }
    })
  })

  it('sends query text for an operation without a persisted hash', async () => {
    const node = { id: '1', name: 'ROB RUN', displayName: 'ROB RUN', boxArtURL: 'x' }
    server.handle(() => ({ body: { data: { searchCategories: { edges: [{ node }] } } } }))
    const result = await client().gql.request(SearchGames, { query: 'rob run', first: 5 })

    expect(result.searchCategories?.edges?.[0]?.node?.name).toBe('ROB RUN')
    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      operationName: 'SearchGames',
      query: SearchGames.query,
      variables: { query: 'rob run', first: 5 }
    })
  })

  it('batches in groups of 20 and keeps results in order', async () => {
    server.handle((request) => {
      const ops = JSON.parse(request.body) as { variables: { channel: string } }[]
      return { body: ops.map((op) => liveStream(op.variables.channel)) }
    })
    const logins = Array.from({ length: 45 }, (_, i) => `ch${i}`)
    const results = await client().gql.batch(
      StreamInfo,
      logins.map((login) => ({ login }))
    )

    expect(results.map((r) => r.user?.login)).toEqual(logins)
    expect(server.requests.map((r) => (JSON.parse(r.body) as unknown[]).length).sort()).toEqual([
      20, 20, 5
    ])
  })

  it('retries "service error" once after at least 5 seconds', async () => {
    let calls = 0
    server.handle(() =>
      ++calls === 1
        ? { body: { errors: [{ message: 'service error' }], data: null } }
        : { body: liveStream('foo') }
    )
    const { gql, scheduler } = client()
    expect((await gql.request(StreamInfo, { login: 'foo' })).user?.id).toBe('id-foo')
    expect(scheduler.delays).toEqual([5000])
  })

  it('gives up when "PersistedQueryNotFound" happens twice', async () => {
    server.handle(() => ({ body: { errors: [{ message: 'PersistedQueryNotFound' }] } }))
    await expect(client().gql.request(StreamInfo, { login: 'foo' })).rejects.toBeInstanceOf(
      GqlError
    )
    expect(server.requests).toHaveLength(2)
  })

  it('retries timeouts with backoff', async () => {
    let calls = 0
    server.handle(() =>
      ++calls < 3
        ? { body: { errors: [{ message: 'service timeout' }] } }
        : { body: liveStream('foo') }
    )
    const { gql, scheduler } = client()
    await gql.request(StreamInfo, { login: 'foo' })
    expect(scheduler.delays).toEqual([1000, 2000])
  })

  it('nulls the failed field on "server error" and keeps the rest', async () => {
    server.handle(() => ({
      body: {
        errors: [{ message: 'server error', path: ['user', 'dropCampaign'] }],
        data: { user: { dropCampaign: { broken: true } } }
      }
    }))
    const result = await client().gql.request(CampaignDetailsQuery, {
      campaignId: 'c1',
      userId: '123'
    })
    expect(result).toEqual({ user: { dropCampaign: null } })
  })

  it('throws on other GQL errors and on top-level errors', async () => {
    server.handle(() => ({ body: { errors: [{ message: 'forbidden' }] } }))
    await expect(client().gql.request(StreamInfo, { login: 'x' })).rejects.toThrow(/forbidden/)
    server.handle(() => ({ body: { error: 'Unauthorized', message: 'invalid token' } }))
    await expect(client().gql.request(StreamInfo, { login: 'x' })).rejects.toThrow(/invalid token/)
  })

  it('throws a shape error when Twitch changes a field we rely on', async () => {
    server.handle(() => ({
      body: { data: { currentUser: { dropCurrentSession: { dropID: 1, minutes: 'x' } } } }
    }))
    const error = await client()
      .gql.request(CurrentDrop, { channelId: '1' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ResponseShapeError)
    expect((error as ResponseShapeError).issues.join()).toMatch(/dropID|currentMinutesWatched/)
  })

  it('reports HTTP errors such as an expired token', async () => {
    server.handle(() => ({ status: 401, body: { error: 'Unauthorized' } }))
    await expect(client().gql.request(StreamInfo, { login: 'x' })).rejects.toThrow(/HTTP 401/)
  })
})

describe('watching for API changes', () => {
  it('reports a changed response with what was expected and what came back', async () => {
    server.handle(() => ({
      body: {
        data: { currentUser: { dropCurrentSession: { dropID: 1, currentMinutesWatched: 3 } } }
      }
    }))
    const issues: ApiIssue[] = []
    await client(issues)
      .gql.request(CurrentDrop, { channelId: '1' })
      .catch(() => {})

    expect(issues).toHaveLength(1)
    const [issue] = issues
    expect(issue).toMatchObject({
      severity: 'error',
      source: 'gql',
      endpoint: 'DropCurrentSessionContext',
      kind: 'shape'
    })
    expect(issue!.checks).toEqual([
      expect.objectContaining({
        path: 'currentUser.dropCurrentSession.dropID',
        expected: expect.objectContaining({ type: 'string' }),
        actual: 1
      })
    ])
  })

  it('says when a field we read is missing', async () => {
    server.handle(() => ({ body: { data: { user: { login: 'foo' } } } }))
    const issues: ApiIssue[] = []
    await client(issues)
      .gql.request(StreamInfo, { login: 'foo' })
      .catch(() => {})
    expect(issues[0]!.checks).toContainEqual(
      expect.objectContaining({ path: 'user.id', missing: true })
    )
  })

  it('warns when Twitch no longer knows a persisted query, and errors when it stays that way', async () => {
    server.handle(() => ({ body: { errors: [{ message: 'PersistedQueryNotFound' }] } }))
    const issues: ApiIssue[] = []
    await client(issues)
      .gql.request(StreamInfo, { login: 'foo' })
      .catch(() => {})
    expect(issues.map((i) => [i.severity, i.kind])).toEqual([
      ['warning', 'retried'],
      ['error', 'retried']
    ])
  })

  it('reports unknown errors and failed fields, but not an expired session', async () => {
    const issues: ApiIssue[] = []
    server.handle(() => ({ body: { errors: [{ message: 'forbidden' }] } }))
    await client(issues)
      .gql.request(StreamInfo, { login: 'x' })
      .catch(() => {})
    server.handle(() => ({
      body: {
        errors: [{ message: 'server error', path: ['user', 'dropCampaign'] }],
        data: { user: { dropCampaign: { broken: true } } }
      }
    }))
    await client(issues).gql.request(CampaignDetailsQuery, { campaignId: 'c1', userId: '1' })
    server.handle(() => ({ status: 401, body: { error: 'Unauthorized' } }))
    await client(issues)
      .gql.request(StreamInfo, { login: 'x' })
      .catch(() => {})

    expect(issues.map((i) => [i.severity, i.kind, i.summary])).toEqual([
      ['error', 'error', expect.stringMatching(/forbidden/)],
      ['warning', 'partial', expect.stringMatching(/user\.dropCampaign/)]
    ])
  })

  it('reports nothing for a matching response, and a failing report never breaks a request', async () => {
    server.handle(() => ({ body: liveStream('foo') }))
    const issues: ApiIssue[] = []
    await client(issues).gql.request(StreamInfo, { login: 'foo' })
    expect(issues).toEqual([])

    server.handle(() => ({ body: { data: { user: { login: 'foo' } } } }))
    // A monitor that throws: the request still fails with the shape error, not the monitor's.
    const gql = createGqlClient({
      http: createHttpClient({
        fetch: (url, init) => fetch(url, init),
        userAgent: 'tdc-test',
        timeoutMs: () => 2000,
        scheduler: recordingScheduler(),
        logger: testLogger()
      }),
      auth: { headers: async () => ({}) },
      url: `${server.url}/gql`,
      limiter: createRateLimiter({
        capacity: 5,
        windowMs: 1000,
        clock: systemClock,
        scheduler: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }
      }),
      scheduler: recordingScheduler(),
      logger: testLogger(),
      monitor: {
        report: () => {
          throw new Error('monitor broke')
        }
      }
    })
    await expect(gql.request(StreamInfo, { login: 'foo' })).rejects.toBeInstanceOf(
      ResponseShapeError
    )
  })
})
