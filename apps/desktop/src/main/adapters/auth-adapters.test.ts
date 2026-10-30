import { CLIENT_PROFILES, TWITCH_ENDPOINTS } from '@tdc/api'
import type { StoredSession } from '@tdc/core'
import type { Logger } from '@tdc/kernel'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveEndpoints } from './endpoints'
import {
  addressBarHtml,
  addressBarView,
  browserUserAgent,
  isBlockedLoginShortcut,
  isLoginNavigationAllowed,
  loginUrl,
  tokenFromRedirect
} from './login-window'
import { canPersistSecrets, createSafeStorageSessionStore } from './session-store'

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

const WEB = 'https://www.twitch.tv'

describe('login window helpers', () => {
  it('builds the same login URL as Twitch’s Android client', () => {
    const url = new URL(loginUrl(WEB, CLIENT_PROFILES.androidApp))
    expect(url.origin + url.pathname).toBe('https://www.twitch.tv/login')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_PROFILES.androidApp.clientId)
    expect(
      Object.fromEntries(new URLSearchParams(url.searchParams.get('redirect_params')!))
    ).toEqual({
      client_id: CLIENT_PROFILES.androidApp.clientId,
      redirect_uri: 'https://www.twitch.tv/',
      response_type: 'token'
    })
    // Double-encoded, exactly as upstream sends it.
    expect(url.search).toContain('redirect_uri%3Dhttps%253A%252F%252Fwww.twitch.tv%252F')
  })

  it.each([
    ['https://www.twitch.tv/#access_token=abc123&scope=&token_type=bearer', 'abc123'],
    ['https://www.twitch.tv/?x=1#access_token=xyz', 'xyz'],
    ['https://www.twitch.tv/', undefined],
    ['https://www.twitch.tv/#error=access_denied', undefined],
    ['https://evil.example/#access_token=abc', undefined],
    ['https://www.twitch.tv.evil.example/#access_token=abc', undefined],
    ['https://www.twitch.tv/#access_token=abc%22%3E', undefined],
    ['not a url', undefined]
  ])('reads the token from %s', (url, expected) => {
    expect(tokenFromRedirect(url, WEB)).toBe(expected)
  })

  it.each([
    ['https://www.twitch.tv/login', true],
    ['https://passport.twitch.tv/x', true],
    ['https://twitch.tv/', true],
    ['http://www.twitch.tv/', false],
    ['https://twitch.tv.evil.example/', false],
    ['https://eviltwitch.tv/', false],
    ['file:///etc/passwd', false]
  ])('allows the login window to visit %s: %s', (url, allowed) => {
    expect(isLoginNavigationAllowed(url, WEB)).toBe(allowed)
  })

  it('allows the configured web origin (the mock Twitch in tests)', () => {
    expect(isLoginNavigationAllowed('http://127.0.0.1:5555/login', 'http://127.0.0.1:5555')).toBe(
      true
    )
  })

  it('presents a plain Chrome user agent', () => {
    expect(
      browserUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) twitch-drop-collector/0.0.0 Chrome/140.0.0.0 Electron/45.1.0 Safari/537.36'
      )
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    )
  })
})

describe('login window address bar', () => {
  it('shows host and path for Twitch, marked secure', () => {
    expect(addressBarView('https://www.twitch.tv/login?client_id=x&redirect_params=y')).toEqual({
      host: 'www.twitch.tv',
      path: '/login',
      secure: true
    })
    const html = addressBarHtml('https://passport.twitch.tv/two_factor')
    expect(html).toContain('passport.twitch.tv')
    expect(html).toContain('Secure connection')
  })

  it('lays out like a browser: indicator first, then host and path with no gap', () => {
    const html = addressBarHtml('https://www.twitch.tv/login')
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('class="host"'))
    expect(html).toContain(
      '<span class="host">www.twitch.tv</span><span class="path">/login</span>'
    )
  })

  it('never shows the query or the #access_token part', () => {
    const html = addressBarHtml('https://www.twitch.tv/?code=1#access_token=supersecret')
    expect(html).not.toContain('supersecret')
    expect(html).not.toContain('code=1')
  })

  it('marks plain http as not secure and escapes what it shows', () => {
    expect(addressBarHtml('http://127.0.0.1:5555/login')).toContain('Not secure')
    expect(addressBarHtml('https://www.twitch.tv/%3Cscript%3E')).not.toContain('<script>')
    expect(addressBarView('nonsense')).toEqual({ host: '', path: '', secure: false })
  })

  it('runs no script of its own', () => {
    const html = addressBarHtml('https://www.twitch.tv/login')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("default-src 'none'")
  })
})

describe('login window shortcuts', () => {
  const key = (
    k: string,
    mods: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}
  ) => ({
    key: k,
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...mods
  })

  it.each([
    ['F12', key('F12')],
    ['Ctrl+Shift+I', key('I', { control: true, shift: true })],
    ['Ctrl+Shift+J', key('j', { control: true, shift: true })],
    ['Cmd+Opt+I', key('i', { meta: true, alt: true })],
    ['Ctrl+=', key('=', { control: true })],
    ['Ctrl++', key('+', { control: true, shift: true })],
    ['Ctrl+-', key('-', { control: true })],
    ['Cmd+0', key('0', { meta: true })]
  ])('blocks %s', (_name, input) => {
    expect(isBlockedLoginShortcut(input)).toBe(true)
  })

  it.each([
    ['typing', key('a')],
    ['Shift+I (a capital letter)', key('I', { shift: true })],
    ['Ctrl+A', key('a', { control: true })],
    ['Ctrl+V', key('v', { control: true })],
    ['Enter', key('Enter')]
  ])('allows %s', (_name, input) => {
    expect(isBlockedLoginShortcut(input)).toBe(false)
  })
})

describe('session store', () => {
  // Reversible stand-in for safeStorage's async API, so tests can see what reaches the disk.
  const fakeSafeStorage = (
    options: { backend?: 'basic_text' | 'gnome_libsecret'; shouldReEncrypt?: boolean } = {}
  ) => ({
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
    encryptStringAsync: vi.fn(async (text: string) => Buffer.from(text, 'utf8').reverse()),
    decryptStringAsync: async (data: Buffer) => ({
      result: Buffer.from(data).reverse().toString('utf8'),
      shouldReEncrypt: options.shouldReEncrypt ?? false
    })
  })
  const session: StoredSession = {
    accessToken: 'secret-token-123',
    userId: '1',
    login: 'kyle',
    clientId: 'c',
    deviceId: 'd'
  }
  const file = (): string => join(mkdtempSync(join(tmpdir(), 'tdc-session-')), 'session.bin')

  it('round-trips an encrypted session and never writes the token in plain text', async () => {
    const path = file()
    const store = await createSafeStorageSessionStore({
      safeStorage: fakeSafeStorage(),
      platform: 'win32',
      file: path,
      logger: testLogger()
    })
    expect(store.persistent).toBe(true)
    expect(await store.read()).toBeUndefined()
    await store.write(session)
    expect(readFileSync(path).toString('utf8')).not.toContain('secret-token-123')
    expect(await store.read()).toEqual(session)
    await store.clear()
    expect(existsSync(path)).toBe(false)
  })

  it('saves again under the new key when the OS asks for re-encryption', async () => {
    const path = file()
    const safeStorage = fakeSafeStorage({ shouldReEncrypt: true })
    const store = await createSafeStorageSessionStore({
      safeStorage,
      platform: 'darwin',
      file: path,
      logger: testLogger()
    })
    await store.write(session)
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledTimes(1)
    expect(await store.read()).toEqual(session)
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledTimes(2)
  })

  it('discards a file it cannot decrypt', async () => {
    const path = file()
    writeFileSync(path, 'garbage')
    const store = await createSafeStorageSessionStore({
      safeStorage: {
        ...fakeSafeStorage(),
        decryptStringAsync: async () => {
          throw new Error('bad')
        }
      },
      platform: 'darwin',
      file: path,
      logger: testLogger()
    })
    expect(await store.read()).toBeUndefined()
    expect(existsSync(path)).toBe(false)
  })

  it('keeps the session in memory only on Linux without a keyring', async () => {
    const path = file()
    const store = await createSafeStorageSessionStore({
      safeStorage: fakeSafeStorage({ backend: 'basic_text' }),
      platform: 'linux',
      file: path,
      logger: testLogger()
    })
    expect(store.persistent).toBe(false)
    await store.write(session)
    expect(await store.read()).toEqual(session)
    expect(existsSync(path)).toBe(false)
  })

  it('decides when secrets can be persisted', async () => {
    const storage = (available: boolean, backend: 'basic_text' | 'kwallet6') => ({
      isAsyncEncryptionAvailable: async () => available,
      getSelectedStorageBackend: () => backend
    })
    expect(await canPersistSecrets(storage(true, 'basic_text'), 'win32')).toBe(true)
    expect(await canPersistSecrets(storage(true, 'kwallet6'), 'linux')).toBe(true)
    expect(await canPersistSecrets(storage(true, 'basic_text'), 'linux')).toBe(false)
    expect(await canPersistSecrets(storage(false, 'kwallet6'), 'darwin')).toBe(false)
  })
})

describe('endpoints', () => {
  it('uses Twitch unless a dev build is pointed at a mock', () => {
    expect(resolveEndpoints({}, false)).toEqual(TWITCH_ENDPOINTS)
    const env = { TDC_TWITCH_ENDPOINTS: JSON.stringify({ id: 'http://127.0.0.1:1/' }) }
    expect(resolveEndpoints(env, false).id).toBe('http://127.0.0.1:1/')
    expect(resolveEndpoints(env, true)).toEqual(TWITCH_ENDPOINTS)
    expect(() => resolveEndpoints({ TDC_TWITCH_ENDPOINTS: '{"evil":"x"}' }, false)).toThrow()
  })
})
