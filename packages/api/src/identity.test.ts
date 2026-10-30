import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHttpClient } from './http'
import { createIdentityClient, type IdentityClient } from './identity'
import { CLIENT_PROFILES } from './profiles'
import {
  recordingScheduler,
  startMockServer,
  testLogger,
  type MockServer
} from './test/mock-server'

let server: MockServer
beforeEach(async () => {
  server = await startMockServer()
})
afterEach(async () => {
  await server.close()
})

function identity(): IdentityClient {
  return createIdentityClient({
    http: createHttpClient({
      fetch: (url, init) => fetch(url, init),
      userAgent: 'tdc-test',
      timeoutMs: () => 2000,
      scheduler: recordingScheduler(),
      logger: testLogger()
    }),
    profile: CLIENT_PROFILES.androidApp,
    url: server.url,
    deviceId: () => 'device-abc'
  })
}

describe('identity client', () => {
  it('validates a token and returns its owner', async () => {
    server.handle(() => ({
      body: {
        client_id: CLIENT_PROFILES.androidApp.clientId,
        login: 'kyle',
        user_id: '123',
        scopes: [],
        expires_in: 0
      }
    }))
    expect(await identity().validate('tok')).toMatchObject({ login: 'kyle', user_id: '123' })
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/oauth2/validate' })
    expect(server.requests[0]?.headers['authorization']).toBe('OAuth tok')
  })

  it('returns undefined for an invalid token', async () => {
    server.handle(() => ({ status: 401, body: { status: 401, message: 'invalid access token' } }))
    expect(await identity().validate('bad')).toBeUndefined()
  })

  it('requests a device code as the client, with the device ID', async () => {
    server.handle(() => ({
      body: {
        device_code: 'D'.repeat(40),
        user_code: 'ABCDEFGH',
        verification_uri: 'https://www.twitch.tv/activate?device-code=ABCDEFGH',
        interval: 5,
        expires_in: 1800
      }
    }))
    const code = await identity().requestDeviceCode()
    expect(code.user_code).toBe('ABCDEFGH')
    const request = server.requests[0]!
    expect(request.path).toBe('/oauth2/device')
    expect(request.body).toBe(`client_id=${CLIENT_PROFILES.androidApp.clientId}&scopes=`)
    expect(request.headers['x-device-id']).toBe('device-abc')
    expect(request.headers['client-id']).toBe(CLIENT_PROFILES.androidApp.clientId)
  })

  it.each([
    [
      200,
      { access_token: 'acc', refresh_token: 'ref' },
      { status: 'granted', accessToken: 'acc', refreshToken: 'ref' }
    ],
    [200, { access_token: 'acc' }, { status: 'granted', accessToken: 'acc' }],
    [400, { status: 400, message: 'authorization_pending' }, { status: 'pending' }],
    [400, { status: 400, message: 'slow_down' }, { status: 'slowDown' }],
    [400, { status: 400, message: 'expired_token' }, { status: 'expired' }],
    [
      400,
      { status: 400, message: 'access_denied' },
      { status: 'denied', message: 'access_denied' }
    ],
    [400, 'not json', { status: 'pending' }]
  ])('maps a %i device poll response %j', async (status, body, expected) => {
    server.handle(() => ({ status, body }))
    expect(await identity().pollDeviceCode('dc')).toEqual(expected)
    expect(server.requests[0]?.body).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code'
    )
  })
})
