// A stand-in for Twitch's login page and id.twitch.tv, for end-to-end auth tests. It mirrors
// what we've seen live: device codes only for the Android TV client ("invalid client" for the
// Android app), and Origin/Referer on identity calls.
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// GQL answers come from the anonymised live fixtures in @tdc/api.
const FIXTURES = fileURLToPath(new URL('../../packages/api/fixtures/twitch/', import.meta.url))
type FixtureItem = { data: Record<string, unknown> }
const fixture = (file: string): FixtureItem[] =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as FixtureItem[]

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

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mock.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return mock
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
    case 'DirectoryPage_Game':
      return fixture('game-directory.json')[0]!.data
    case 'DropCurrentSessionContext':
      return { currentUser: { dropCurrentSession: null } }
    case 'DropsPage_ClaimDropRewards': {
      const input = variables['input'] as { dropInstanceID: string }
      mock.claims.push(input.dropInstanceID)
      return { claimDropRewards: { status: 'ELIGIBLE_FOR_ALL' } }
    }
    case 'PlaybackAccessToken':
      return { streamPlaybackAccessToken: null }
    default:
      return {}
  }
}
