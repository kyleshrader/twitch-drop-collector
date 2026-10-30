// A stand-in for Twitch's login page and id.twitch.tv, for end-to-end auth tests. It mirrors
// what we've seen live: device codes only for the Android TV client ("invalid client" for the
// Android app), and Origin/Referer on identity calls.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

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
