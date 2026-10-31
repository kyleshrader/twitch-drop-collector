// M7 acceptance: sign in and out against a mock Twitch, and no token is reachable from the
// renderer.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import {
  ANDROID_CLIENT_ID,
  DEVICE_TOKEN,
  startMockTwitch,
  WINDOW_TOKEN,
  type MockTwitch
} from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

const launch = (userDataDir = newUserDataDir()): ReturnType<typeof launchApp> =>
  launchApp(userDataDir, { TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url)) })

/** The visible sign-in: Twitch's login window (Android app client), as upstream. */
async function startWindowSignIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
}

/**
 * Device-code sign-in has no button for now (Android TV sessions can't see campaigns), so the
 * test starts it the way a button would, through the renderer's IPC API.
 */
async function startCodeSignIn(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }
    ).api.invoke('auth:signIn', { method: 'deviceCode' })
  )
  // A button would refresh the panel's auth state; without one, reload so it polls again.
  // (Main pushes auth changes to the renderer from M8.)
  await page.reload()
}

const status = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('auth-status')

/** Everything the renderer can see or ask main for, as one string. */
async function everythingTheRendererCanReach(
  app: ElectronApplication,
  page: Page
): Promise<string> {
  const fromRenderer = await page.evaluate(async () => {
    const api = (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api
    const replies = await Promise.all(
      ['auth:getState', 'settings:get', 'app:getInfo'].map((c) => api.invoke(c))
    )
    return JSON.stringify({
      replies,
      html: document.documentElement.outerHTML,
      cookie: document.cookie,
      local: { ...localStorage },
      session: { ...sessionStorage }
    })
  })
  // Cookies in the app's own session (the login window uses a separate partition).
  const appCookies = await app.evaluate(async ({ session }) =>
    JSON.stringify(await session.defaultSession.cookies.get({}))
  )
  return fromRenderer + appCookies
}

test('signs in with the Twitch login window and keeps the token out of the renderer', async () => {
  const { app, window: page, userDataDir } = await launch()
  try {
    await expect(status(page)).toHaveText('Not signed in')
    await startWindowSignIn(page)
    await expect(status(page)).toHaveText('Signed in as e2euser')

    // The login page was asked for exactly what Twitch's Android app asks for.
    expect(twitch.loginRequests[0]?.searchParams.get('client_id')).toBe(ANDROID_CLIENT_ID)
    // The login window closed itself.
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1)

    expect(await everythingTheRendererCanReach(app, page)).not.toContain(WINDOW_TOKEN)

    // Saved encrypted: the file exists, and the token isn't in it as plain text.
    const saved = readFileSync(join(userDataDir, 'session.bin'))
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.toString('latin1')).not.toContain(WINDOW_TOKEN)
  } finally {
    await app.close()
  }
})

test('restores the session after a restart, then signs out completely', async () => {
  const userDataDir = newUserDataDir()
  const first = await launch(userDataDir)
  await startWindowSignIn(first.window)
  await expect(status(first.window)).toHaveText('Signed in as e2euser')
  await first.app.close()

  const second = await launch(userDataDir)
  try {
    await expect(status(second.window)).toHaveText('Signed in as e2euser')
    expect(twitch.loginRequests).toHaveLength(1) // restored, not signed in again

    await second.window.getByRole('button', { name: 'Sign out' }).click()
    await expect(status(second.window)).toHaveText('Not signed in')
    expect(existsSync(join(userDataDir, 'session.bin'))).toBe(false)
    const loginCookies = await second.app.evaluate(async ({ session }) =>
      session.fromPartition('persist:twitch-login').cookies.get({})
    )
    expect(loginCookies).toEqual([])
  } finally {
    await second.app.close()
  }
})

test('signs in with a device code', async () => {
  const { app, window: page } = await launch()
  try {
    // The login window is the only visible method; code sign-in is reachable only through IPC.
    await expect(page.getByRole('button', { name: /^Sign in/ })).toHaveCount(1)
    await startCodeSignIn(page)
    await expect(page.getByTestId('device-code')).toHaveText('E2ECODE1')
    await expect(status(page)).toHaveText('Signed in as e2euser', { timeout: 10_000 })
    expect(await everythingTheRendererCanReach(app, page)).not.toContain(DEVICE_TOKEN)
  } finally {
    await app.close()
  }
})

test('asks to sign in again when the saved token has been revoked', async () => {
  const userDataDir = newUserDataDir()
  const first = await launch(userDataDir)
  await startWindowSignIn(first.window)
  await expect(status(first.window)).toHaveText('Signed in as e2euser')
  await first.app.close()

  twitch.validTokens.delete(WINDOW_TOKEN)
  const second = await launch(userDataDir)
  try {
    await expect(status(second.window)).toHaveText('Your Twitch session expired. Sign in again.')
    expect(existsSync(join(userDataDir, 'session.bin'))).toBe(false)
  } finally {
    await second.app.close()
  }
})

test('the login window shows the page address in its own address bar', async () => {
  twitch.holdLogin = true
  const { app, window: page } = await launch()
  try {
    await startWindowSignIn(page)
    await expect(status(page)).toHaveText('Finish signing in in the Twitch window…')

    // The address bar is our own static page, rendered from a data: URL.
    const addressBar = async (): Promise<string> =>
      app.evaluate(({ webContents }) => {
        const bar = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith('data:text/html'))
        return bar ? decodeURIComponent(bar.getURL().split(',').slice(1).join(',')) : ''
      })
    await expect.poll(addressBar).toContain('/login')
    const html = await addressBar()
    expect(html).toContain('127.0.0.1')
    expect(html).toContain('Not secure') // the mock is plain http; real Twitch shows Secure
    expect(html).not.toContain('client_id') // no query string

    const title = await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((w) => w.getTitle())
    )
    expect(title).toContain(`Sign in to Twitch (${new URL(twitch.url).host})`)

    // Fixed size and no DevTools. (Zoom shortcuts are covered by unit tests: Electron has no
    // built-in zoom except through menus, which this window doesn't have.)
    // The address bar can show the URL before the page's own webContents reports it.
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((w) => w.getURL().includes('/login') && !w.getURL().startsWith('data:'))
        )
      )
      .toBe(true)
    const lockdown = await app.evaluate(async ({ BaseWindow, webContents }) => {
      const login = BaseWindow.getAllWindows().find((w) => w.getTitle().startsWith('Sign in'))!
      const twitchPage = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('/login') && !w.getURL().startsWith('data:'))!
      twitchPage.openDevTools()
      return {
        resizable: login.isResizable(),
        maximizable: login.isMaximizable(),
        fullScreenable: login.isFullScreenable(),
        devTools: twitchPage.isDevToolsOpened(),
        // The mock is on loopback, a secure context, so WebAuthn would be there if enabled.
        secureContext: (await twitchPage.executeJavaScript('isSecureContext')) as boolean,
        passkeys: (await twitchPage.executeJavaScript('typeof PublicKeyCredential')) as string
      }
    })
    expect(lockdown).toEqual({
      resizable: false,
      // Electron doesn't implement maximizable on Linux; it always reports true there.
      maximizable: process.platform === 'linux',
      fullScreenable: false,
      devTools: false,
      secureContext: true,
      passkeys: 'undefined'
    })

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(status(page)).toHaveText('Not signed in')
    await expect
      .poll(() => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length))
      .toBe(1)
  } finally {
    await app.close()
  }
})
