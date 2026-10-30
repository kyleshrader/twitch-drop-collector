import {
  CLIENT_PROFILES,
  type DeviceCode,
  type DevicePoll,
  type IdentityClient,
  type TokenInfo
} from '@tdc/api'
import { AbortError, type Logger } from '@tdc/kernel'
import { createManualTime, flushMicrotasks } from '@tdc/kernel/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  activationUrl,
  createAuthService,
  NotSignedInError,
  type AuthState,
  type LoginWindow,
  type SessionStore,
  type StoredSession
} from './auth-service'

const CLIENT_ID = CLIENT_PROFILES.androidApp.clientId
const TV_CLIENT_ID = CLIENT_PROFILES.androidTv.clientId

function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

function memoryStore(initial?: StoredSession): SessionStore & { saved?: StoredSession } {
  const store = {
    saved: initial,
    persistent: true,
    read: async () => store.saved,
    write: async (session: StoredSession) => {
      store.saved = session
    },
    clear: async () => {
      store.saved = undefined
    }
  }
  return store
}

const info = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  client_id: CLIENT_ID,
  login: 'kyle',
  user_id: '123',
  expires_in: 0,
  ...overrides
})

function setup(
  options: {
    stored?: StoredSession
    validate?: (token: string) => Promise<TokenInfo | undefined>
    obtainToken?: LoginWindow['obtainToken']
    polls?: DevicePoll[]
    deviceCodes?: DeviceCode[]
  } = {}
) {
  const time = createManualTime()
  const store = memoryStore(options.stored)
  const identityClients: string[] = []
  const polls = [...(options.polls ?? [])]
  const codes = [...(options.deviceCodes ?? [])]
  const identity: IdentityClient = {
    // Device-code tokens belong to the TV client; everything else to the Android app.
    validate: vi.fn(
      options.validate ??
        (async (token: string) => info(token === 'device-token' ? { client_id: TV_CLIENT_ID } : {}))
    ),
    requestDeviceCode: vi.fn(async () => {
      return (
        codes.shift() ?? {
          device_code: 'dc',
          user_code: 'ABCDEFGH',
          verification_uri: 'https://www.twitch.tv/activate',
          interval: 5,
          expires_in: 1800
        }
      )
    }),
    pollDeviceCode: vi.fn(async (): Promise<DevicePoll> => polls.shift() ?? { status: 'pending' })
  }
  const loginWindow = {
    obtainToken: vi.fn(options.obtainToken ?? (async () => 'window-token')),
    forget: vi.fn(async () => {})
  }
  const auth = createAuthService({
    identity: (profile) => {
      identityClients.push(profile.clientId)
      return identity
    },
    store,
    loginWindow,
    profiles: { loginWindow: CLIENT_PROFILES.androidApp, deviceCode: CLIENT_PROFILES.androidTv },
    clock: time.clock,
    scheduler: time.scheduler,
    logger: testLogger(),
    random: () => 0.5
  })
  const states: AuthState['status'][] = []
  auth.onChange((s) => states.push(s.status))
  return { auth, store, identity, loginWindow, time, states, identityClients }
}

const stored: StoredSession = {
  accessToken: 'saved-token',
  userId: '123',
  login: 'kyle',
  clientId: CLIENT_ID,
  deviceId: 'saved-device'
}

describe('auth service', () => {
  it('starts signed out with nothing saved', async () => {
    const { auth, states } = setup()
    await auth.start()
    expect(auth.state()).toEqual({ status: 'signedOut' })
    expect(states).toEqual(['restoring', 'signedOut'])
    await expect(auth.gqlAuth.headers()).rejects.toBeInstanceOf(NotSignedInError)
  })

  it('restores a saved session after validating it', async () => {
    const { auth, identity } = setup({ stored })
    await auth.start()
    expect(auth.state()).toEqual({
      status: 'signedIn',
      user: { id: '123', login: 'kyle' },
      verified: true
    })
    expect(identity.validate).toHaveBeenCalledWith('saved-token', expect.anything())
    expect(auth.deviceId()).toBe('saved-device')
    expect(await auth.gqlAuth.headers()).toEqual({
      'Client-Id': CLIENT_ID,
      Origin: 'https://www.twitch.tv',
      Referer: 'https://www.twitch.tv',
      'User-Agent': expect.stringContaining('tv.twitch.android.app'),
      Authorization: 'OAuth saved-token',
      'Client-Session-Id': '8888888888888888',
      'X-Device-Id': 'saved-device'
    })
  })

  it.each([
    ['Twitch rejects it', async () => undefined],
    ['it belongs to another client', async () => info({ client_id: 'someone-else' })]
  ])('forgets a saved session when %s', async (_name, validate) => {
    const { auth, store } = setup({ stored, validate })
    await auth.start()
    expect(auth.state()).toMatchObject({
      status: 'signedOut',
      message: expect.stringMatching(/expired/)
    })
    expect(store.saved).toBeUndefined()
  })

  it('keeps the saved session, unverified, when Twitch is unreachable', async () => {
    const { auth, store } = setup({
      stored,
      validate: async () => {
        throw new Error('offline')
      }
    })
    await auth.start()
    expect(auth.state()).toEqual({
      status: 'signedIn',
      user: { id: '123', login: 'kyle' },
      verified: false
    })
    expect(store.saved).toEqual(stored)
  })

  it('signs in with the login window and saves the session', async () => {
    const { auth, store, states } = setup()
    await auth.signIn('loginWindow')
    expect(auth.state()).toMatchObject({ status: 'signedIn', user: { login: 'kyle' } })
    expect(states).toEqual(['signingIn', 'signedIn'])
    expect(store.saved).toEqual({
      accessToken: 'window-token',
      userId: '123',
      login: 'kyle',
      clientId: CLIENT_ID,
      deviceId: auth.deviceId()
    })
    expect(await auth.accessToken()).toBe('window-token')
  })

  it('signs in with a device code, polling at the given interval', async () => {
    const { auth, identity, time } = setup({
      polls: [
        { status: 'pending' },
        { status: 'slowDown' },
        { status: 'granted', accessToken: 'device-token' }
      ]
    })
    const done = auth.signIn('deviceCode')
    await flushMicrotasks()
    expect(auth.state()).toMatchObject({
      status: 'signingIn',
      method: 'deviceCode',
      deviceCode: {
        userCode: 'ABCDEFGH',
        verificationUri: 'https://www.twitch.tv/activate?device-code=ABCDEFGH'
      }
    })
    await time.advance(5000)
    expect(identity.pollDeviceCode).toHaveBeenCalledTimes(1)
    await time.advance(5000)
    expect(identity.pollDeviceCode).toHaveBeenCalledTimes(2)
    // slow_down adds 5 seconds to the interval
    await time.advance(9999)
    expect(identity.pollDeviceCode).toHaveBeenCalledTimes(2)
    await time.advance(1)
    await done
    expect(auth.state()).toMatchObject({ status: 'signedIn' })
    expect(await auth.accessToken()).toBe('device-token')
  })

  it('presents a device-code session as the Android TV client', async () => {
    const { auth, time, identityClients } = setup({
      polls: [{ status: 'granted', accessToken: 'device-token' }]
    })
    const done = auth.signIn('deviceCode')
    await time.advance(5000)
    await done
    expect(identityClients).toEqual([TV_CLIENT_ID])
    expect(await auth.gqlAuth.headers()).toMatchObject({
      'Client-Id': TV_CLIENT_ID,
      Origin: 'https://android.tv.twitch.tv',
      'User-Agent': expect.stringContaining('Smart Box')
    })
  })

  it('discards a saved session from an unknown client', async () => {
    const { auth, store, identity } = setup({ stored: { ...stored, clientId: 'unknown' } })
    await auth.start()
    expect(auth.state()).toMatchObject({ status: 'signedOut' })
    expect(store.saved).toBeUndefined()
    expect(identity.validate).not.toHaveBeenCalled()
  })

  it('requests a new device code when the old one expires', async () => {
    const { auth, identity, time } = setup({
      deviceCodes: [
        { device_code: 'a', user_code: 'AAAA', verification_uri: 'u', interval: 5, expires_in: 10 },
        { device_code: 'b', user_code: 'BBBB', verification_uri: 'u', interval: 5, expires_in: 600 }
      ]
    })
    void auth.signIn('deviceCode')
    await time.advance(10_000)
    await time.advance(0)
    expect(identity.requestDeviceCode).toHaveBeenCalledTimes(2)
    expect(auth.state()).toMatchObject({ deviceCode: { userCode: 'BBBB' } })
    auth.cancelSignIn()
  })

  it('returns to signed out when the user cancels', async () => {
    const { auth, store } = setup({
      obtainToken: (signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AbortError())))
    })
    const done = auth.signIn('loginWindow')
    await flushMicrotasks()
    auth.cancelSignIn()
    await done
    expect(auth.state()).toEqual({ status: 'signedOut' })
    expect(store.saved).toBeUndefined()
  })

  it('reports a failed sign-in', async () => {
    const { auth } = setup({ validate: async () => undefined })
    await auth.signIn('loginWindow')
    expect(auth.state()).toEqual({
      status: 'signedOut',
      message: 'Twitch did not accept the new sign-in'
    })
  })

  it('signs out: forgets the token, the saved session and the login cookies', async () => {
    const { auth, store, loginWindow } = setup({ stored })
    await auth.start()
    await auth.signOut()
    expect(auth.state()).toEqual({ status: 'signedOut' })
    expect(store.saved).toBeUndefined()
    expect(loginWindow.forget).toHaveBeenCalled()
    await expect(auth.accessToken()).rejects.toBeInstanceOf(NotSignedInError)
  })

  it('invalidates the session when Twitch rejects the token later', async () => {
    const { auth, store } = setup({ stored })
    await auth.start()
    await auth.invalidate('Your Twitch session expired. Sign in again.')
    expect(auth.state()).toMatchObject({ status: 'signedOut', message: expect.any(String) })
    expect(store.saved).toBeUndefined()
  })
})

describe('activationUrl', () => {
  it('fills in the code when Twitch leaves it out, and keeps it when present', () => {
    expect(activationUrl('https://www.twitch.tv/activate', 'ABCD1234')).toBe(
      'https://www.twitch.tv/activate?device-code=ABCD1234'
    )
    expect(activationUrl('https://www.twitch.tv/activate?device-code=WXYZ9876', 'ABCD1234')).toBe(
      'https://www.twitch.tv/activate?device-code=WXYZ9876'
    )
    expect(activationUrl('not a url', 'ABCD1234')).toBe('not a url')
  })
})
