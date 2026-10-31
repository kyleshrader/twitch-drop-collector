// A stand-in for Twitch's login page and id.twitch.tv, for end-to-end auth tests. It mirrors
// what we've seen live: device codes only for the Android TV client ("invalid client" for the
// Android app), and Origin/Referer on identity calls.
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'

// GQL answers come from the anonymised live fixtures in @tdc/api.
const FIXTURES = fileURLToPath(new URL('../../packages/api/fixtures/twitch/', import.meta.url))
type FixtureItem = { data: Record<string, unknown> }

/** About when the fixtures were captured. Their dates are moved so that this moment is now. */
const CAPTURED_AT = Date.parse('2026-10-30T09:00:00Z')
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function shiftDates(value: unknown, byMs: number): unknown {
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    return new Date(Date.parse(value) + byMs).toISOString()
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, byMs))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, byMs)]))
  }
  return value
}

/** A fixture file, with its campaigns running now just as they were at capture. */
const fixture = (file: string): FixtureItem[] =>
  shiftDates(
    JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')),
    Date.now() - CAPTURED_AT
  ) as FixtureItem[]

/**
 * The game of the one fixture campaign that is linked and has no allow-list, so the miner
 * watches it from the game directory. The directory fixture is for Rust; for this game the mock
 * serves the same streams as Black Desert ones.
 */
export const MINING_GAME = { id: '386821', slug: 'black-desert', displayName: 'Black Desert' }
/** Its drops, in order: 60, 120 and 180 minutes. */
export const MINING_DROPS = [
  { id: '27228107-c688-11f1-96cc-0a58a9feac02', name: 'AOS Day 9 (1 Hour)' },
  { id: 'ae76f030-c688-11f1-bdd3-0a58a9feac02', name: 'AOS Day 9 (2 Hours)' }
] as const

interface DirectoryStream {
  id: string
  title: string
  viewersCount: number
  broadcaster: { id: string; login: string; displayName: string }
}
/** The directory's live channels, most viewers first. */
export const MINING_CHANNELS = (
  fixture('game-directory.json')[0]!.data['game'] as {
    streams: { edges: { node: DirectoryStream }[] }
  }
).streams.edges
  .map((e) => e.node)
  .sort((a, b) => b.viewersCount - a.viewersCount)

export const ANDROID_CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp'
export const ANDROID_TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa'
export const WINDOW_TOKEN = 'e2ewindowtoken0123456789'
export const DEVICE_TOKEN = 'e2edevicetoken9876543210'

const TWITCH_ORIGINS = ['https://www.twitch.tv', 'https://android.tv.twitch.tv']

export interface MockTwitch {
  url: string
  /** Tokens /oauth2/validate accepts, with the client each was issued to. */
  validTokens: Map<string, string>
  loginRequests: URL[]
  /** When true, /login shows a page and waits instead of logging in instantly. */
  holdLogin: boolean
  /** GQL operations received, in order (operationName). */
  gqlCalls: string[]
  /** Drop instance IDs claimed through ClaimDrop. */
  claims: string[]
  /** Logins whose stream was "watched" (a segment HEAD request), in order. */
  watched: string[]
  /** Logins of directory channels that are offline. */
  offline: Set<string>
  /** PubSub topics the app currently listens to. */
  topics: Set<string>
  /** Sends a PubSub message on a topic to every connection listening to it. */
  publish(topic: string, message: object): void
  close(): Promise<void>
}

export async function startMockTwitch(): Promise<MockTwitch> {
  const mock: MockTwitch = {
    url: '',
    validTokens: new Map([
      [WINDOW_TOKEN, ANDROID_CLIENT_ID],
      [DEVICE_TOKEN, ANDROID_TV_CLIENT_ID]
    ]),
    loginRequests: [],
    holdLogin: false,
    gqlCalls: [],
    claims: [],
    watched: [],
    offline: new Set(),
    topics: new Set(),
    publish: () => {},
    close: async () => {}
  }
  let devicePolls = 0

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', mock.url)
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    req.on('end', () => {
      const form = new URLSearchParams(raw)

      if (req.method === 'POST' && url.pathname === '/gql') {
        const token = (req.headers.authorization ?? '').replace(/^OAuth /, '')
        if (!mock.validTokens.has(token)) return json(401, { error: 'Unauthorized' })
        const body = JSON.parse(raw) as unknown
        const ops = (Array.isArray(body) ? body : [body]) as {
          operationName: string
          variables?: Record<string, unknown>
        }[]
        const answers = ops.map((op) => {
          mock.gqlCalls.push(op.operationName)
          return { data: gqlAnswer(op.operationName, op.variables ?? {}, mock) }
        })
        return json(200, Array.isArray(body) ? answers : answers[0]!)
      }

      // Usher and the HLS playlists: one variant, one segment. The app only sends HEAD requests
      // for segments, which is what counts as watching.
      const usher = /^\/api\/channel\/hls\/([^/]+)\.m3u8$/.exec(url.pathname)
      const hls = /^\/hls\/([^/]+)\/(low\.m3u8|segment\.ts)$/.exec(url.pathname)
      const playlist = (body: string): void => {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end(body)
      }
      if (req.method === 'GET' && usher) {
        const login = decodeURIComponent(usher[1]!)
        if (mock.offline.has(login)) return json(404, [{ error: 'Can not find channel' }])
        return playlist(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=160000\n/hls/${login}/low.m3u8\n`)
      }
      if (hls && hls[2] === 'low.m3u8' && req.method === 'GET') {
        if (mock.offline.has(hls[1]!)) return json(404, [{ error: 'Can not find channel' }])
        return playlist('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nsegment.ts\n')
      }
      if (hls && hls[2] === 'segment.ts' && req.method === 'HEAD') {
        mock.watched.push(hls[1]!)
        res.writeHead(200, { 'content-type': 'video/mp2t' }).end()
        return
      }

      if (req.method === 'GET' && url.pathname === '/login') {
        mock.loginRequests.push(url)
        if (mock.holdLogin) {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end('<!doctype html><title>Log in to Twitch</title><p>Log in')
          return
        }
        // The user "logs in" instantly. The cookie lets tests check that signing out clears
        // the login window's storage.
        res
          .writeHead(302, {
            location: `${mock.url}/#access_token=${WINDOW_TOKEN}&scope=&token_type=bearer`,
            'set-cookie': 'twilight-user=e2e; Path=/; Max-Age=3600'
          })
          .end()
        return
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<!doctype html><title>Twitch</title>')
        return
      }
      if (req.method === 'GET' && url.pathname === '/oauth2/validate') {
        const token = (req.headers.authorization ?? '').replace(/^OAuth /, '')
        const clientId = mock.validTokens.get(token)
        if (!clientId) return json(401, { status: 401, message: 'invalid access token' })
        return json(200, {
          client_id: clientId,
          login: 'e2euser',
          user_id: '4242',
          scopes: [],
          expires_in: 0
        })
      }
      if (req.method === 'POST' && url.pathname.startsWith('/oauth2/')) {
        // Insist on Origin and Referer, so the tests prove the app's network adapter sends both.
        const origin = req.headers.origin ?? ''
        const referer = req.headers.referer ?? ''
        if (!TWITCH_ORIGINS.includes(origin) || !referer.startsWith(origin)) {
          return json(400, { status: 400, message: 'missing origin or referer' })
        }
        if (form.get('client_id') !== ANDROID_TV_CLIENT_ID) {
          return json(400, { status: 400, message: 'invalid client' })
        }
      }
      if (req.method === 'POST' && url.pathname === '/oauth2/device') {
        devicePolls = 0
        return json(200, {
          device_code: 'D'.repeat(40),
          user_code: 'E2ECODE1',
          verification_uri: `${mock.url}/activate?device-code=E2ECODE1`,
          interval: 1,
          expires_in: 600
        })
      }
      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        // The user "enters the code" after the first poll.
        if (++devicePolls < 2) return json(400, { status: 400, message: 'authorization_pending' })
        return json(200, { access_token: DEVICE_TOKEN, token_type: 'bearer' })
      }
      json(404, { error: 'not found' })
    })
  })

  // PubSub on the same port: LISTEN/UNLISTEN, PING/PONG, and MESSAGE frames on demand.
  const pubsub = new WebSocketServer({ server })
  const listening = new Map<WebSocket, Set<string>>()
  const syncTopics = (): void => {
    mock.topics.clear()
    for (const topics of listening.values()) for (const t of topics) mock.topics.add(t)
  }
  pubsub.on('connection', (socket) => {
    const topics = new Set<string>()
    listening.set(socket, topics)
    socket.on('close', () => {
      listening.delete(socket)
      syncTopics()
    })
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as {
        type: string
        nonce?: string
        data?: { topics?: string[] }
      }
      if (frame.type === 'PING') return socket.send(JSON.stringify({ type: 'PONG' }))
      if (frame.type !== 'LISTEN' && frame.type !== 'UNLISTEN') return
      for (const topic of frame.data?.topics ?? []) {
        if (frame.type === 'LISTEN') topics.add(topic)
        else topics.delete(topic)
      }
      syncTopics()
      socket.send(JSON.stringify({ type: 'RESPONSE', nonce: frame.nonce, error: '' }))
    })
  })
  mock.publish = (topic, message) => {
    for (const [socket, topics] of listening) {
      if (!topics.has(topic)) continue
      socket.send(
        JSON.stringify({ type: 'MESSAGE', data: { topic, message: JSON.stringify(message) } })
      )
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mock.close = () =>
    new Promise((resolve) => {
      for (const socket of pubsub.clients) socket.terminate()
      pubsub.close()
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return mock
}

/** A directory channel as Twitch reports it, playing the mining game, or offline. */
function streamInfo(login: string, mock: MockTwitch): unknown {
  const channel = MINING_CHANNELS.find((c) => c.broadcaster.login === login)
  if (!channel) return { user: null }
  return {
    user: {
      id: channel.broadcaster.id,
      login,
      displayName: channel.broadcaster.displayName,
      broadcastSettings: { title: channel.title, game: MINING_GAME },
      stream: mock.offline.has(login)
        ? null
        : { id: channel.id, viewersCount: channel.viewersCount }
    }
  }
}

const details = new Map(
  fixture('campaign-details.json').map((item) => {
    const campaign = (item.data['user'] as { dropCampaign: { id: string } }).dropCampaign
    return [campaign.id, item.data] as const
  })
)

/** Answers a GQL operation like Twitch did when the fixtures were captured. */
function gqlAnswer(
  operation: string,
  variables: Record<string, unknown>,
  mock: MockTwitch
): unknown {
  switch (operation) {
    case 'Inventory':
      return fixture('inventory.json')[0]!.data
    case 'ViewerDropsDashboard':
      return fixture('campaigns.json')[0]!.data
    case 'DropCampaignDetails':
      return (
        details.get(String(variables['dropID'])) ?? {
          user: { id: '10000001', dropCampaign: null }
        }
      )
    case 'DirectoryPage_Game': {
      const directory = fixture('game-directory.json')[0]!.data
      if (variables['slug'] !== MINING_GAME.slug) return directory
      const game = directory['game'] as { streams: { edges: { node: DirectoryStream }[] } }
      const edges = game.streams.edges
        .filter((e) => !mock.offline.has(e.node.broadcaster.login))
        .map((e) => ({ ...e, node: { ...e.node, game: MINING_GAME } }))
      return { game: { ...game, streams: { ...game.streams, edges } } }
    }
    case 'VideoPlayerStreamInfoOverlayChannel':
      return streamInfo(String(variables['channel']), mock)
    case 'DropCurrentSessionContext':
      return { currentUser: { dropCurrentSession: null } }
    case 'DropsPage_ClaimDropRewards': {
      const input = variables['input'] as { dropInstanceID: string }
      mock.claims.push(input.dropInstanceID)
      return { claimDropRewards: { status: 'ELIGIBLE_FOR_ALL' } }
    }
    case 'PlaybackAccessToken':
      return { streamPlaybackAccessToken: { value: '{"channel":"e2e"}', signature: 'e2esig' } }
    default:
      return {}
  }
}
