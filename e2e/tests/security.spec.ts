import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { appEnv, launchApp, MAIN_ENTRY } from './app'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, window: page, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await app.close()
})

const windowCount = (): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

test('test windows stay invisible unless TDC_E2E_SHOW_WINDOWS=1', async () => {
  test.skip(process.env['TDC_E2E_SHOW_WINDOWS'] === '1', 'windows were asked to be shown')
  const state = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window && { opacity: window.getOpacity(), focusable: window.isFocusable() }
  })
  expect(state).toEqual({ opacity: 0, focusable: false })
})

test('loads the renderer from app:// rather than file://', async () => {
  expect(page.url()).toBe('app://renderer/index.html')
  await expect(page.getByRole('heading', { name: 'Twitch Drop Collector' })).toBeVisible()
})

test('window uses the fixed webPreferences', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // Undocumented and untyped, but the only way to read the effective preferences. If it
    // disappears, 'renderer has no Node or ipcRenderer access' still checks the behaviour.
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as
      { getLastWebPreferences(): Electron.WebPreferences } | undefined
    const p = contents?.getLastWebPreferences()
    return (
      p && {
        contextIsolation: p.contextIsolation,
        sandbox: p.sandbox,
        nodeIntegration: p.nodeIntegration,
        nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames,
        webSecurity: p.webSecurity,
        webviewTag: p.webviewTag
      }
    )
  })
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    webviewTag: false
  })
})

test('renderer has no Node or ipcRenderer access', async () => {
  const globals = await page.evaluate(() => ({
    require: 'require' in globalThis,
    process: 'process' in globalThis,
    electron: 'electron' in globalThis,
    api: typeof (globalThis as { api?: unknown }).api
  }))
  expect(globals).toEqual({ require: false, process: false, electron: false, api: 'object' })
})

test('strict Content-Security-Policy is in force', async () => {
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')

  const inlineScriptRan = await page.evaluate(async () => {
    const script = document.createElement('script')
    script.textContent = 'window.__inlineRan = true'
    document.head.append(script)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return (window as { __inlineRan?: boolean }).__inlineRan === true
  })
  expect(inlineScriptRan).toBe(false)
})

test('new windows and off-origin navigation are denied; https links go to the system browser', async () => {
  // Record openExternal calls instead of launching a real browser.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = async (url: string): Promise<void> => {
      opened.push(url)
    }
  })

  const popup = await page.evaluate(() => window.open('https://example.com/popup'))
  expect(popup).toBeNull()
  await page.evaluate(() => window.open('file:///etc/passwd'))

  await page.evaluate(() => {
    location.href = 'https://example.com/navigate'
  })
  await page.waitForTimeout(250)

  expect(page.url()).toBe('app://renderer/index.html')
  expect(await windowCount()).toBe(1)
  const opened = await app.evaluate(() => (globalThis as { __opened?: string[] }).__opened)
  expect(opened).toEqual(['https://example.com/popup', 'https://example.com/navigate'])
})

test('a second launch exits and focuses the existing window', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())

  const second = spawn(electronPath as unknown as string, [MAIN_ENTRY], {
    env: appEnv(userDataDir),
    stdio: 'ignore'
  })
  const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve))
  expect(exitCode).toBe(0)

  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())
    )
    .toBe(false)
  expect(await windowCount()).toBe(1)
})
