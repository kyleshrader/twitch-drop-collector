import { DEFAULT_SETTINGS } from '@tdc/config'
import type { Logger } from '@tdc/kernel'
import { describe, expect, it, vi } from 'vitest'
import { createInvokeHandlers } from './handlers'
import { createInvokeRouter, type InvokeHandlers } from './router'

const TRUSTED = 'app://renderer/index.html'

function silentLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

function setup(overrides: Partial<InvokeHandlers> = {}): {
  route: ReturnType<typeof createInvokeRouter>
  openExternal: ReturnType<typeof vi.fn>
  logger: Logger
} {
  const openExternal = vi.fn(async () => {})
  const handlers = {
    ...createInvokeHandlers({
      app: { getName: () => 'Twitch Drop Collector', getVersion: () => '1.2.3' },
      shell: { openExternal },
      platform: 'win32',
      settings: { get: () => DEFAULT_SETTINGS, update: async () => DEFAULT_SETTINGS },
      auth: {
        state: () => ({ status: 'signedOut' }),
        signIn: async () => {},
        cancelSignIn: () => {},
        signOut: async () => {}
      }
    }),
    ...overrides
  }
  const logger = silentLogger()
  const route = createInvokeRouter({
    handlers,
    isTrustedSender: (url) => url.startsWith('app://renderer/'),
    logger
  })
  return { route, openExternal, logger }
}

describe('invoke router', () => {
  it('runs the handler for a valid request', async () => {
    const { route, openExternal } = setup()
    expect(await route('app:getInfo', undefined, TRUSTED)).toEqual({
      ok: true,
      value: { name: 'Twitch Drop Collector', version: '1.2.3', platform: 'win32' }
    })
    expect(await route('shell:openExternal', { url: 'https://www.twitch.tv/' }, TRUSTED)).toEqual({
      ok: true,
      value: { opened: true }
    })
    expect(openExternal).toHaveBeenCalledWith('https://www.twitch.tv/')
  })

  it.each([
    ['a non-https URL', { url: 'file:///C:/Windows/System32/calc.exe' }],
    ['a javascript: URL', { url: 'javascript:alert(1)' }],
    ['a number instead of a URL', { url: 42 }],
    ['a missing field', {}],
    ['no payload', undefined]
  ])('rejects %s before the handler runs', async (_name, payload) => {
    const { route, openExternal } = setup()
    const result = await route('shell:openExternal', payload, TRUSTED)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    if (!result.ok) expect(result.error.issues).not.toHaveLength(0)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects input on a channel that takes none', async () => {
    const { route } = setup()
    expect(await route('app:getInfo', { sneaky: true }, TRUSTED)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
  })

  it.each([
    ['another origin', 'https://evil.example/'],
    ['a different custom scheme', 'evil://renderer/index.html'],
    ['a destroyed frame', undefined]
  ])('rejects senders from %s', async (_name, senderUrl) => {
    const { route, openExternal } = setup()
    const result = await route('shell:openExternal', { url: 'https://www.twitch.tv/' }, senderUrl)
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each(['shell:runCommand', '__proto__', 'constructor'])(
    'rejects the unknown channel %s',
    async (channel) => {
      const { route } = setup()
      expect(await route(channel, undefined, TRUSTED)).toMatchObject({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL' }
      })
    }
  )

  it('hides handler errors from the renderer and logs them', async () => {
    const { route, logger } = setup({
      'app:getInfo': () => {
        throw new Error('secret internal detail')
      }
    })
    const result = await route('app:getInfo', undefined, TRUSTED)
    expect(result).toEqual({
      ok: false,
      error: { code: 'HANDLER_FAILED', message: 'The request failed' }
    })
    expect(logger.error).toHaveBeenCalled()
  })

  it('rejects handler output that breaks the contract', async () => {
    const { route } = setup({
      'app:getInfo': () => ({ name: 'x' }) as unknown as ReturnType<InvokeHandlers['app:getInfo']>
    })
    expect(await route('app:getInfo', undefined, TRUSTED)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_OUTPUT' }
    })
  })
})
