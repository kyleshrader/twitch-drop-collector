import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ORIGIN,
  isSafeExternalUrl,
  isSameOrigin,
  mainWindowOptions,
  resolveRendererPath
} from './policy'

describe('mainWindowOptions', () => {
  it('keeps the fixed security settings', () => {
    expect(mainWindowOptions('/preload.js').webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: '/preload.js'
    })
  })
})

describe('isSafeExternalUrl', () => {
  it.each(['https://www.twitch.tv/drops/inventory', 'https://example.com'])('allows %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it.each([
    'http://example.com',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'smb://host/share',
    'not a url'
  ])('rejects %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})

describe('isSameOrigin', () => {
  it('matches the app origin and the dev server', () => {
    expect(isSameOrigin(`${APP_ORIGIN}/index.html`, APP_ORIGIN)).toBe(true)
    expect(isSameOrigin('http://localhost:5173/#/settings', 'http://localhost:5173')).toBe(true)
  })

  it.each([
    'app://evil/index.html',
    'other://renderer/index.html',
    'http://localhost:5174/',
    'https://localhost:5173/',
    'http://localhost:5173.evil.com/',
    'not a url'
  ])('rejects %s', (url) => {
    const origin = url.startsWith('http') ? 'http://localhost:5173' : APP_ORIGIN
    expect(isSameOrigin(url, origin)).toBe(false)
  })
})

describe('resolveRendererPath', () => {
  const dir = join('/app', 'out', 'renderer')

  it('serves files inside the renderer directory', () => {
    expect(resolveRendererPath(dir, '/')).toBe(join(dir, 'index.html'))
    expect(resolveRendererPath(dir, '/assets/index.js')).toBe(join(dir, 'assets', 'index.js'))
  })

  it.each(['/../main/index.js', '/%2e%2e/main/index.js', '/..%2f..%2fsecret', '/%E0%A4%A'])(
    'rejects %s',
    (pathname) => {
      expect(resolveRendererPath(dir, pathname)).toBeNull()
    }
  )
})
