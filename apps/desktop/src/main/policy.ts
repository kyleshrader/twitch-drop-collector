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
