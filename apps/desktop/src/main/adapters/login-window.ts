// Twitch's own login page in an isolated window, under our own address bar so it's clear the
// page really is twitch.tv. The page runs on its own persistent session partition (never the
// app's), with no preload, sandboxed. We only watch its URL: when Twitch redirects to
// `<web>/#access_token=…`, the token is taken from the URL and the window closes.
import type {
  BaseWindow as BaseWindowType,
  Session,
  WebContentsView as WebContentsViewType
} from 'electron'
import type { ClientProfile } from '@tdc/api'
import type { LoginWindow } from '@tdc/core'
import { AbortError, type Logger } from '@tdc/kernel'
import { SECURE_WEB_PREFERENCES } from '../policy'

export const LOGIN_PARTITION = 'persist:twitch-login'
/** In-memory partition for the address bar; it only ever shows data: URLs we generate. */
const ADDRESS_BAR_PARTITION = 'tdc-login-address-bar'
const ADDRESS_BAR_HEIGHT = 44

export function loginUrl(web: string, profile: ClientProfile): string {
  // Matches what Twitch's Android app sends; the redirect target is the web root.
  const redirect = new URLSearchParams({
    client_id: profile.clientId,
    redirect_uri: `${web}/`,
    response_type: 'token'
  })
  const url = new URL('/login', web)
  url.searchParams.set('client_id', profile.clientId)
  url.searchParams.set('redirect_params', redirect.toString())
  return url.toString()
}

/** The access token if `url` is Twitch's post-login redirect, otherwise undefined. */
export function tokenFromRedirect(url: string, web: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.origin !== new URL(web).origin) return undefined
  const token = new URLSearchParams(parsed.hash.slice(1)).get('access_token')
  return token && /^\w+$/.test(token) ? token : undefined
}

/** Where the login window may navigate: Twitch's sites over https, or the configured web origin. */
export function isLoginNavigationAllowed(url: string, web: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.origin === new URL(web).origin) return true
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'twitch.tv' || parsed.hostname.endsWith('.twitch.tv'))
    )
  } catch {
    return false
  }
}

/** Electron's default user agent without the Electron and app tokens, so Twitch sees Chrome. */
export function browserUserAgent(fallback: string): string {
  return fallback.replace(/\s(Electron|twitch-drop-collector|Twitch Drop Collector)\/\S+/gi, '')
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** What the address bar shows: host and path only, never the query or the #… part. */
export function addressBarView(url: string): { host: string; path: string; secure: boolean } {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.host,
      path: parsed.pathname === '/' ? '' : parsed.pathname,
      secure: parsed.protocol === 'https:'
    }
  } catch {
    return { host: '', path: '', secure: false }
  }
}

/** The address bar as a static page (no script; JavaScript is off in its view anyway). */
const LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>'
const WARNING_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/></svg>'

/**
 * The address bar as a static page (no script; JavaScript is off in its view anyway). Styled
 * like a browser's address field, but read-only: muted fill, security indicator on the left,
 * host and path run together.
 */
export function addressBarHtml(url: string): string {
  const { host, path, secure } = addressBarView(url)
  const indicator = secure
    ? `<span class="indicator" title="Secure connection">${LOCK_ICON}<span class="sr">Secure connection</span></span>`
    : `<span class="indicator insecure">${WARNING_ICON}Not secure</span><span class="divider"></span>`
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root{color-scheme:light dark;--toolbar:#f8f9fa;--field:#e8eaed;--border:#dadce0;--host:#3c4043;--path:#70757a;--icon:#5f6368;--bad:#c5221f}
@media (prefers-color-scheme:dark){:root{--toolbar:#292a2d;--field:#202124;--border:#3c4043;--host:#c4c7c5;--path:#8e918f;--icon:#9aa0a6;--bad:#f28b82}}
html,body{margin:0;height:100%;background:var(--toolbar);font:13px/normal system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;user-select:none;cursor:default}
body{display:flex;align-items:center;padding:0 8px;box-sizing:border-box;border-bottom:1px solid var(--border)}
.field{flex:1;min-width:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;box-sizing:border-box;background:var(--field);border:1px solid var(--border);border-radius:6px}
.indicator{display:flex;align-items:center;gap:4px;flex:none;color:var(--icon)}
.insecure{color:var(--bad);font-weight:500}
.divider{width:1px;height:14px;background:var(--border);flex:none}
.url{min-width:0;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.host{color:var(--host)}.path{color:var(--path)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style></head><body><div class="field" data-testid="address">${indicator}<span class="url"><span class="host">${escapeHtml(host)}</span><span class="path">${escapeHtml(path)}</span></span></div></body></html>`
}

/** Keyboard shortcuts the login window ignores: zoom, and the DevTools combinations. */
export function isBlockedLoginShortcut(input: {
  key: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}): boolean {
  const key = input.key.toLowerCase()
  const command = input.control || input.meta
  if (key === 'f12') return true
  if (command && ['+', '=', '-', '_', '0'].includes(key)) return true
  if (command && input.shift && ['i', 'j', 'c'].includes(key)) return true
  if (input.meta && input.alt && ['i', 'j', 'c'].includes(key)) return true
  return false
}

/**
 * No zoom and no DevTools shortcuts. Electron only zooms through menu items (Ctrl+wheel just
 * emits zoom-changed for the app to handle), and the window has no menu; but macOS's app menu
 * is global, so its zoom accelerators are blocked here too. Pinch zoom is pinned off as well.
 */
function lockDown(contents: Electron.WebContents): void {
  contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  // preventDefault here also stops menu accelerators (Electron docs, before-input-event).
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && isBlockedLoginShortcut(input)) event.preventDefault()
  })
}

export function createLoginWindow(deps: {
  BaseWindow: typeof BaseWindowType
  WebContentsView: typeof WebContentsViewType
  session: Session
  web: string
  profile: ClientProfile
  userAgent: string
  allowNavigation: (contents: Electron.WebContents, allow: (url: string) => boolean) => void
  /** Hidden windows for end-to-end tests (see TDC_E2E_INVISIBLE). */
  invisible?: boolean
  logger: Logger
}): LoginWindow {
  const { BaseWindow, WebContentsView, session, web, profile, userAgent, allowNavigation, logger } =
    deps

  // The login page needs no camera, notifications or the like.
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  return {
    obtainToken(signal) {
      return new Promise<string>((resolve, reject) => {
        if (signal.aborted) return reject(new AbortError())
        // A fixed, plain window: no resizing, no menu (its hidden accelerators would still work).
        const window = new BaseWindow({
          width: 500,
          height: 800,
          title: 'Sign in to Twitch',
          show: false,
          resizable: false,
          maximizable: false,
          fullscreenable: false,
          ...(deps.invisible ? { opacity: 0, skipTaskbar: true, focusable: false } : {})
        })
        window.setMenu?.(null)
        // devTools: false makes DevTools impossible to open, whatever the shortcut or menu.
        const bar = new WebContentsView({
          webPreferences: {
            ...SECURE_WEB_PREFERENCES,
            devTools: false,
            javascript: false,
            partition: ADDRESS_BAR_PARTITION
          }
        })
        const page = new WebContentsView({
          webPreferences: { ...SECURE_WEB_PREFERENCES, devTools: false, session }
        })
        window.contentView.addChildView(bar)
        window.contentView.addChildView(page)
        const { width, height } = window.getContentBounds()
        bar.setBounds({ x: 0, y: 0, width, height: ADDRESS_BAR_HEIGHT })
        page.setBounds({ x: 0, y: ADDRESS_BAR_HEIGHT, width, height: height - ADDRESS_BAR_HEIGHT })
        for (const view of [bar, page]) lockDown(view.webContents)

        const contents = page.webContents
        contents.setUserAgent(userAgent)
        allowNavigation(contents, (url) => isLoginNavigationAllowed(url, web))

        const showAddress = (url: string): void => {
          const { host } = addressBarView(url)
          window.setTitle(host ? `Sign in to Twitch (${host})` : 'Sign in to Twitch')
          void bar.webContents
            .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(addressBarHtml(url))}`)
            .catch(() => undefined)
        }

        let settled = false
        const finish = (outcome: { token: string } | { error: Error }): void => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          if (!window.isDestroyed()) window.close()
          if ('token' in outcome) resolve(outcome.token)
          else reject(outcome.error)
        }
        const onAbort = (): void => finish({ error: new AbortError() })
        signal.addEventListener('abort', onAbort, { once: true })

        const check = (url: string): void => {
          const token = tokenFromRedirect(url, web)
          if (token) {
            logger.info('Twitch login completed')
            finish({ token })
          } else {
            showAddress(url)
          }
        }
        for (const event of ['will-redirect', 'will-navigate'] as const) {
          contents.on(event as 'will-navigate', (_event, url) => {
            if (tokenFromRedirect(url, web)) check(url)
          })
        }
        contents.on('did-navigate', (_event, url) => check(url))
        contents.on('did-navigate-in-page', (_event, url) => check(url))
        window.on('closed', () => {
          // Views aren't destroyed with their window.
          bar.webContents.close()
          contents.close()
          finish({ error: new AbortError('Login window closed') })
        })

        const url = loginUrl(web, profile)
        showAddress(url)
        if (!deps.invisible) window.show()
        void contents.loadURL(url).catch((error: unknown) => {
          // A redirect we intercepted also aborts the load; only report real failures.
          if (!settled) logger.warn('Login page failed to load', { error })
        })
      })
    },
    async forget() {
      await session.clearStorageData()
    }
  }
}
