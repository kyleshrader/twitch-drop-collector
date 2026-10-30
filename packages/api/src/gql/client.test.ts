import { createRateLimiter, systemClock } from '@tdc/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GqlError, ResponseShapeError } from '../errors'
import { createHttpClient } from '../http'
import { CLIENT_PROFILES } from '../profiles'
import {
  recordingScheduler,
  startMockServer,
  testLogger,
  type MockServer
} from '../test/mock-server'
import { createGqlClient, type GqlClient } from './client'
import { CampaignDetailsQuery, CurrentDrop, StreamInfo } from './operations'

let server: MockServer
beforeEach(async () => {
  server = await startMockServer()
})
afterEach(async () => {
  await server.close()
})

function client(): { gql: GqlClient; scheduler: ReturnType<typeof recordingScheduler> } {
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
    auth: { headers: async () => ({ Authorization: 'OAuth test-token' }) },
    profile: CLIENT_PROFILES.androidApp,
    url: `${server.url}/gql`,
    limiter: createRateLimiter({
      capacity: 5,
      windowMs: 1000,
      clock: systemClock,
      scheduler: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }
    }),
    scheduler,
    logger,
    random: () => 0.5
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
      userLogin: 'me'
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
