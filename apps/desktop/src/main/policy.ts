// Security policy as plain data and pure functions, so it can be unit-tested without Electron.
import type { BrowserWindowConstructorOptions, WebPreferences } from 'electron'
import { isAbsolute, join, relative } from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'renderer'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

// Fixed by the spec: every BrowserWindow uses these.
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false
} as const satisfies WebPreferences

/**
 * Keeps end-to-end test windows off the developer's screen (TDC_E2E_INVISIBLE). A fully
 * transparent window gets no frames on Linux, so every Playwright action there waited about 2 s;
 * on Linux the window goes off-screen instead. macOS would pull an off-screen window back.
 */
export function invisibleWindowOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  const hidden = platform === 'linux' ? { x: -32000, y: -32000 } : { opacity: 0 }
  return { ...hidden, skipTaskbar: true, focusable: false }
}

export function mainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload }
  }
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Only https links are handed to the system browser. */
export function isSafeExternalUrl(url: string): boolean {
  return parse(url)?.protocol === 'https:'
}

/**
 * Compares parsed scheme and host (including port); prefix checks on the raw string can be
 * bypassed. URL.origin is not used because Node reports "null" for custom schemes like app:.
 */
export function isSameOrigin(url: string, origin: string): boolean {
  const a = parse(url)
  const b = parse(origin)
  return a !== null && b !== null && a.protocol === b.protocol && a.host === b.host
}

/** Twitch's image CDN; the only host the image cache fetches from. */
const IMAGE_HOST = /(^|\.)jtvnw\.net$/

/**
 * The remote image a tdc-image:// request asks for, or null unless it is an https image on
 * Twitch's CDN. Keeps the image cache from being used to fetch anything else.
 */
export function remoteImageUrl(requestUrl: string, imageOrigin: string): string | null {
  const request = parse(requestUrl)
  if (!request || !isSameOrigin(requestUrl, imageOrigin) || request.pathname !== '/') return null
  const remote = parse(request.searchParams.get('url') ?? '')
  if (!remote || remote.protocol !== 'https:' || remote.port || remote.username) return null
  return IMAGE_HOST.test(remote.hostname) ? remote.href : null
}

/** Maps an app:// request path onto a file inside rendererDir, or null if it escapes it. */
export function resolveRendererPath(rendererDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = join(rendererDir, decoded === '/' ? 'index.html' : decoded)
  const rel = relative(rendererDir, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return file
}
