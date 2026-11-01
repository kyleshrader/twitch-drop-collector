import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ORIGIN,
  invisibleWindowOptions,
  isSafeExternalUrl,
  isSameOrigin,
  mainWindowOptions,
  remoteImageUrl,
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

describe('invisibleWindowOptions', () => {
  it('keeps test windows unfocusable and off the taskbar everywhere', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(invisibleWindowOptions(platform)).toMatchObject({
        skipTaskbar: true,
        focusable: false
      })
    }
  })

  it('moves them off-screen on Linux, where a transparent window gets no frames', () => {
    expect(invisibleWindowOptions('linux')).toMatchObject({ x: -32000, y: -32000 })
    expect(invisibleWindowOptions('linux')).not.toHaveProperty('opacity')
    expect(invisibleWindowOptions('win32')).toMatchObject({ opacity: 0 })
    expect(invisibleWindowOptions('darwin')).toMatchObject({ opacity: 0 })
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

describe('remoteImageUrl', () => {
  const origin = 'tdc-image://cache'
  const ask = (remote: string): string => `${origin}/?url=${encodeURIComponent(remote)}`

  it.each([
    'https://static-cdn.jtvnw.net/ttv-boxart/2009321156_IGDB.jpg',
    'https://static-cdn.jtvnw.net/twitch-quests-assets/REWARD/a.png'
  ])('serves %s', (remote) => {
    expect(remoteImageUrl(ask(remote), origin)).toBe(remote)
  })

  it.each([
    'http://static-cdn.jtvnw.net/a.png',
    'https://static-cdn.jtvnw.net:8443/a.png',
    'https://user@static-cdn.jtvnw.net/a.png',
    'https://jtvnw.net.evil.com/a.png',
    'https://evil-jtvnw.net/a.png',
    'https://localhost/a.png',
    'file:///C:/Windows/win.ini',
    'not a url'
  ])('refuses %s', (remote) => {
    expect(remoteImageUrl(ask(remote), origin)).toBeNull()
  })

  it('refuses other hosts, paths, and a missing url', () => {
    const remote = encodeURIComponent('https://static-cdn.jtvnw.net/a.png')
    expect(remoteImageUrl(`tdc-image://other/?url=${remote}`, origin)).toBeNull()
    expect(remoteImageUrl(`tdc-image://cache/x?url=${remote}`, origin)).toBeNull()
    expect(remoteImageUrl(`app://cache/?url=${remote}`, origin)).toBeNull()
    expect(remoteImageUrl(`${origin}/`, origin)).toBeNull()
  })
})
