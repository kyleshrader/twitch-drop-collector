import {
  app,
  BaseWindow,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  safeStorage,
  session,
  shell,
  WebContentsView
} from 'electron'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  CLIENT_PROFILES,
  createHttpClient,
  createIdentityClient,
  pickUserAgent,
  systemScheduler
} from '@tdc/api'
import { createSettingsService } from '@tdc/config'
import { createAuthService } from '@tdc/core'
import { systemClock } from '@tdc/kernel'
import { openStorage } from '@tdc/storage'
import icon from '../../resources/icon.png?asset'
import { resolveEndpoints } from './adapters/endpoints'
import { createJsonFileStore } from './adapters/json-file-store'
import { createLoginItem } from './adapters/login-item'
import { browserUserAgent, createLoginWindow, LOGIN_PARTITION } from './adapters/login-window'
import { applyProxy, createNetFetch, requestTimeoutMs } from './adapters/network'
import { createSafeStorageSessionStore } from './adapters/session-store'
import { createInvokeHandlers } from './ipc/handlers'
import { registerInvokeRoute } from './ipc/register'
import { createInvokeRouter } from './ipc/router'
import { createConsoleLogger } from './logger'
import { APP_ORIGIN, isSameOrigin, mainWindowOptions } from './policy'
import { allowNavigation, hardenWebContents, registerAppScheme, serveRenderer } from './security'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
// End-to-end tests run windows transparent, unfocusable and off the taskbar, so they never pop
// up on the developer's screen. Ignored in packaged builds.
const invisibleForTests = process.env['TDC_E2E_INVISIBLE'] === '1' && !app.isPackaged
const rendererOrigin = devServerUrl ?? APP_ORIGIN
const logger = createConsoleLogger({ level: is.dev ? 'debug' : 'info' })

let mainWindow: BrowserWindow | null = null

function createWindow(options: { startMinimized?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    ...mainWindowOptions(join(__dirname, '../preload/index.js')),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(invisibleForTests ? { opacity: 0, skipTaskbar: true, focusable: false } : {})
  })

  window.on('ready-to-show', () => {
    if (options.startMinimized) {
      // Until the tray exists (M8), "start minimised" means minimised to the taskbar.
      window.showInactive()
      window.minimize()
    } else {
      window.show()
    }
  })
  if (is.dev) {
    // Surface renderer warnings and errors (including CSP violations) in the dev terminal.
    window.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
      if (level === 'warning' || level === 'error') {
        console.log(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`)
      }
    })
  }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  void window.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`)
  return window
}

function focusMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

registerAppScheme()

// Lets end-to-end tests run against an isolated profile. Ignored in packaged builds.
const userDataOverride = process.env['TDC_USER_DATA_DIR']
if (userDataOverride && !app.isPackaged) app.setPath('userData', userDataOverride)

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the lock; it receives 'second-instance' and focuses its window.
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  void (async (): Promise<void> => {
    await app.whenReady()
    electronApp.setAppUserModelId('com.github.twitchdropcollector')

    // F12 toggles DevTools in development; reload shortcuts are ignored in production.
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    serveRenderer(join(__dirname, '../renderer'))
    hardenWebContents(rendererOrigin)

    const settings = await createSettingsService({
      store: createJsonFileStore({
        file: join(app.getPath('userData'), 'settings.json'),
        logger: logger.child('settings')
      }),
      logger: logger.child('settings')
    })
    const loginItem = createLoginItem({
      app,
      platform: process.platform,
      argv: process.argv,
      execPath: process.execPath,
      env: process.env,
      homedir: homedir(),
      desktopFileName: 'twitch-drop-collector.desktop',
      productName: app.getName(),
      fs: { mkdir, writeFile, rm },
      logger: logger.child('login-item')
    })
    const syncLoginItem = (enabled: boolean): void => {
      loginItem.setEnabled(enabled).catch((error: unknown) => {
        logger.error('Could not update launch at login', { error })
      })
    }

    const syncProxy = (proxy: string): void => {
      applyProxy(session.defaultSession, proxy).catch((error: unknown) => {
        logger.error('Could not apply the proxy setting', { error })
      })
    }

    const initial = settings.get()
    logger.setLevel(is.dev ? 'debug' : initial.logging.level)
    nativeTheme.themeSource = initial.general.theme
    // The setting is the source of truth; re-apply it in case the OS entry was changed elsewhere.
    syncLoginItem(initial.general.launchAtLogin)
    syncProxy(initial.network.proxy)
    settings.subscribe((next, previous) => {
      if (next.network.proxy !== previous.network.proxy) syncProxy(next.network.proxy)
      if (!is.dev && next.logging.level !== previous.logging.level) {
        logger.setLevel(next.logging.level)
      }
      if (next.general.theme !== previous.general.theme) {
        nativeTheme.themeSource = next.general.theme
      }
      if (next.general.launchAtLogin !== previous.general.launchAtLogin) {
        syncLoginItem(next.general.launchAtLogin)
      }
    })

    // Local database: migrated before anything reads it; a database that can't be used is moved
    // aside and recreated (it only holds cache and history).
    const storage = openStorage({
      file: join(app.getPath('userData'), 'tdc.db'),
      clock: systemClock,
      logger: logger.child('storage')
    })
    const purgeCache = (): void => {
      const purged = storage.cache.purgeExpired()
      if (purged > 0) logger.child('storage').debug('Purged expired cache entries', { purged })
    }
    purgeCache()
    const purgeTimer = setInterval(purgeCache, 60 * 60 * 1000)
    app.on('will-quit', () => {
      clearInterval(purgeTimer)
      storage.close()
    })

    // Twitch, over Electron's net stack. A session presents as the Twitch client it signed in
    // with: the Android app (login window) or the Android TV app (device code). See
    // docs/decisions.md.
    const endpoints = resolveEndpoints(process.env, app.isPackaged)
    const profile = CLIENT_PROFILES.androidApp
    const http = createHttpClient({
      fetch: createNetFetch(net),
      userAgent: pickUserAgent(profile),
      timeoutMs: () => requestTimeoutMs(settings.get().network.connectionQuality),
      scheduler: systemScheduler,
      logger: logger.child('http')
    })
    const auth = createAuthService({
      identity: (clientProfile, deviceId) =>
        createIdentityClient({ http, profile: clientProfile, url: endpoints.id, deviceId }),
      store: await createSafeStorageSessionStore({
        safeStorage,
        platform: process.platform,
        file: join(app.getPath('userData'), 'session.bin'),
        logger: logger.child('auth')
      }),
      loginWindow: createLoginWindow({
        BaseWindow,
        WebContentsView,
        session: session.fromPartition(LOGIN_PARTITION),
        web: endpoints.web,
        profile,
        userAgent: browserUserAgent(app.userAgentFallback),
        allowNavigation,
        invisible: invisibleForTests,
        logger: logger.child('login')
      }),
      // The Android app client no longer gets device codes; the Android TV client does.
      profiles: { loginWindow: profile, deviceCode: CLIENT_PROFILES.androidTv },
      clock: systemClock,
      scheduler: systemScheduler,
      logger: logger.child('auth')
    })

    registerInvokeRoute(
      ipcMain,
      createInvokeRouter({
        handlers: createInvokeHandlers({
          app,
          shell,
          platform: process.platform,
          settings,
          auth
        }),
        isTrustedSender: (url) => isSameOrigin(url, rendererOrigin),
        logger: logger.child('ipc')
      })
    )

    mainWindow = createWindow({
      startMinimized: loginItem.launchedAtLogin() && initial.general.startMinimized
    })
    // Restoring validates the saved token over the network; don't hold up the window for it.
    void auth.start()

    // macOS: re-create the window when the dock icon is clicked and none are open.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })().catch((error: unknown) => {
    logger.error('Startup failed', { error })
    dialog.showErrorBox('Twitch Drop Collector could not start', String(error))
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
