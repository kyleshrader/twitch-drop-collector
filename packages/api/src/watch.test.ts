import { createRateLimiter, systemClock } from '@tdc/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGqlClient } from './gql/client'
import { createHttpClient } from './http'
import { systemScheduler } from './runtime'
import {
  recordingScheduler,
  startMockServer,
  testLogger,
  type MockReply,
  type MockServer,
  type RecordedRequest
} from './test/mock-server'
import { createHlsWatcher, playlistEntries, type StreamWatcher } from './watch'

let server: MockServer
beforeEach(async () => {
  server = await startMockServer()
})
afterEach(async () => {
  await server.close()
})

function watcher(): StreamWatcher {
  const logger = testLogger()
  const http = createHttpClient({
    fetch: (url, init) => fetch(url, init),
    userAgent: 'tdc-test',
    timeoutMs: () => 2000,
    scheduler: recordingScheduler(),
    logger
  })
  const gql = createGqlClient({
    http,
    auth: { headers: async () => ({}) },
    url: `${server.url}/gql`,
    limiter: createRateLimiter({
      capacity: 5,
      windowMs: 1000,
      clock: systemClock,
      scheduler: systemScheduler
    }),
    scheduler: recordingScheduler(),
    logger
  })
  return createHlsWatcher({ http, gql, usherUrl: server.url, logger })
}

/** A stream with two variants; the low one has three segments (two absolute, one relative). */
function liveStream(overrides: Partial<Record<string, MockReply>> = {}) {
  return (request: RecordedRequest): MockReply => {
    const route = `${request.method} ${request.path.split('?')[0]}`
    if (overrides[route]) return overrides[route]
    switch (route) {
      case 'POST /gql':
        return {
          body: { data: { streamPlaybackAccessToken: { value: '{"tok":1}', signature: 'sig1' } } }
        }
      case 'GET /api/channel/hls/foo.m3u8':
        return {
          body: [
            '#EXTM3U',
            '#EXT-X-STREAM-INF:BANDWIDTH=6000000',
            `${server.url}/v/source.m3u8`,
            '#EXT-X-STREAM-INF:BANDWIDTH=200000',
            `${server.url}/v/low.m3u8`
          ].join('\n')
        }
      case 'GET /v/low.m3u8':
        return {
          body: [
            '#EXTM3U',
            '#EXTINF:2.000,live',
            `${server.url}/seg/1.ts`,
            '#EXTINF:2.000,live',
            `${server.url}/seg/2.ts`,
            '#EXTINF:2.000,live',
            '../seg/3.ts'
          ].join('\n')
        }
      case 'HEAD /seg/1.ts':
      case 'HEAD /seg/2.ts':
      case 'HEAD /seg/3.ts':
        return { status: 200 }
      default:
        return { status: 404 }
    }
  }
}

const routes = (): string[] => server.requests.map((r) => `${r.method} ${r.path.split('?')[0]}`)

describe('hls watcher', () => {
  it('fetches the lowest variant and HEADs every segment', async () => {
    server.handle(liveStream())
    expect(await watcher().watch('foo')).toBe(true)
    expect(routes()).toEqual([
      'POST /gql',
      'GET /api/channel/hls/foo.m3u8',
      'GET /v/low.m3u8',
      'HEAD /seg/1.ts',
      'HEAD /seg/2.ts',
      'HEAD /seg/3.ts'
    ])
    const usher = new URL(server.requests[1]!.path, server.url)
    expect(usher.searchParams.get('sig')).toBe('sig1')
    expect(usher.searchParams.get('token')).toBe('{"tok":1}')
  })

  it('reuses the variant URL on later ticks', async () => {
    server.handle(liveStream())
    const w = watcher()
    await w.watch('foo')
    server.requests.length = 0
    expect(await w.watch('foo')).toBe(true)
    expect(routes()[0]).toBe('GET /v/low.m3u8')
  })

  it('reports false when usher answers with a JSON error', async () => {
    server.handle(
      liveStream({
        'GET /api/channel/hls/foo.m3u8': {
          status: 200,
          body: [{ error: 'twirp error not_found: transcode does not exist' }]
        }
      })
    )
    expect(await watcher().watch('foo')).toBe(false)
  })

  it('reports false without a playback token', async () => {
    server.handle(
      liveStream({ 'POST /gql': { body: { data: { streamPlaybackAccessToken: null } } } })
    )
    expect(await watcher().watch('foo')).toBe(false)
  })

  it('forgets the variant when it stops working, and resolves a new one next time', async () => {
    const w = watcher()
    server.handle(liveStream())
    await w.watch('foo')

    server.handle(liveStream({ 'GET /v/low.m3u8': { status: 404 } }))
    expect(await w.watch('foo')).toBe(false)

    server.handle(liveStream())
    server.requests.length = 0
    expect(await w.watch('foo')).toBe(true)
    expect(routes()[0]).toBe('POST /gql')
  })

  it('reports false when a segment is not served', async () => {
    server.handle(liveStream({ 'HEAD /seg/2.ts': { status: 403 } }))
    expect(await watcher().watch('foo')).toBe(false)
  })
})

describe('playlistEntries', () => {
  it('resolves relative entries and skips tags and blanks', () => {
    expect(
      playlistEntries(
        '#EXTM3U\n\nhttps://a/x.ts\n  b/y.ts  \n#EXTINF:2\n',
        'https://cdn/p/list.m3u8'
      )
    ).toEqual(['https://a/x.ts', 'https://cdn/p/b/y.ts'])
  })
})
