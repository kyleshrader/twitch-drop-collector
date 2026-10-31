import {
  app,
  BaseWindow,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  session,
  Notification,
  shell,
  Tray,
  WebContentsView
} from 'electron'
import electronLog from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
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
import { createAuthService, createConnectivity } from '@tdc/core'
import type { MinerView } from '@tdc/ipc-contract'
import { systemClock } from '@tdc/kernel'
import { NewerDatabaseError, openStorage } from '@tdc/storage'
import icon from '../../resources/icon.png?asset'
import { resolveEndpoints } from './adapters/endpoints'
import { createJsonFileStore } from './adapters/json-file-store'
import { createLoginItem } from './adapters/login-item'
import { browserUserAgent, createLoginWindow, LOGIN_PARTITION } from './adapters/login-window'
import { applyProxy, createNetFetch, requestTimeoutMs } from './adapters/network'
import { createSafeStorageSessionStore } from './adapters/session-store'
import { runGqlProbe } from './dev/gql-probe'
import { createEventPublisher, throttle } from './ipc/events'
import { createMiningRuntime } from './miner/runtime'
import { createInvokeHandlers } from './ipc/handlers'
import { registerInvokeRoute } from './ipc/register'
import { createInvokeRouter } from './ipc/router'
import { createCrashReports, watchProcesses } from './diagnostics'
import { createAppLogger } from './logger'
import { APP_ORIGIN, isSameOrigin, mainWindowOptions } from './policy'
import { createImageCache } from './images/image-cache'
import {
  allowNavigation,
  hardenWebContents,
  registerAppSchemes,
  serveImages,
  serveRenderer
} from './security'
import { createAppTray } from './shell/tray'
import { createElectronUpdateEngine } from './adapters/update-engine'
import { createUpdater } from './updates/updater'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
// End-to-end tests run windows transparent, unfocusable and off the taskbar, so they never pop
// up on the developer's screen. Honoured in packaged builds too, for the packaged smoke test; it
// changes nothing but how windows are shown.
const invisibleForTests = process.env['TDC_E2E_INVISIBLE'] === '1'
const rendererOrigin = devServerUrl ?? APP_ORIGIN
const logsFolder = (): string => join(app.getPath('userData'), 'logs')
const logger = createAppLogger({
  log: electronLog,
  file: () => join(logsFolder(), 'main.log'),
  level: is.dev ? 'debug' : 'info',
  console: is.dev
})
watchProcesses({
  app,
  process,
  isAppPage: (contents) => isSameOrigin(contents.getURL(), rendererOrigin),
  logger: logger.child('process')
})

let mainWindow: BrowserWindow | null = null
/** True once the app is really quitting, so closing the window must not just hide it. */
let quitting = false
/** Set once settings and the tray exist: whether closing the window hides it instead. */
let hideOnClose = (): boolean => false
/** Called when the window is shown or hidden, so the tray menu can follow. */
let onWindowVisibility = (): void => {}

function createWindow(options: { startMinimized?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    ...mainWindowOptions(join(__dirname, '../preload/index.js')),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(invisibleForTests ? { opacity: 0, skipTaskbar: true, focusable: false } : {})
  })

  window.on('ready-to-show', () => {
    // The packaged-build smoke test waits for this line.
    logger.info('Main window ready', { version: app.getVersion() })
    // Starting minimised means staying in the tray; without a tray, minimised to the taskbar.
    if (!options.startMinimized) {
      window.show()
    } else if (!hideOnClose()) {
      window.showInactive()
      window.minimize()
    }
  })
  window.on('close', (event) => {
    if (quitting || !hideOnClose()) return
    event.preventDefault()
    window.hide()
  })
  window.on('show', () => onWindowVisibility())
  window.on('hide', () => onWindowVisibility())
  if (is.dev) {
    // Renderer warnings (CSP violations among them) in the dev terminal; errors are always logged.
    window.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
      if (level === 'warning')
        console.log(`[renderer:warning] ${message} (${sourceId}:${lineNumber})`)
    })
  }
  // A crashed page leaves a blank window: load it again, but not in a crash loop.
  let lastRecovery = 0
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || Date.now() - lastRecovery < 60_000) return
    lastRecovery = Date.now()
    if (!window.isDestroyed()) window.webContents.reload()
  })
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

registerAppSchemes()

// No passkeys (WebAuthn) in any page. Twitch's sign-in page offers them, which on Windows pops up
// a Windows Security dialog; without WebAuthn the page falls back to username and password.
app.commandLine.appendSwitch('disable-blink-features', 'WebAuth')

// Lets end-to-end tests run against an isolated profile. Ignored in packaged builds.
const userDataOverride = process.env['TDC_USER_DATA_DIR']
if (userDataOverride && !app.isPackaged) {
  app.setPath('userData', userDataOverride)
  app.setPath('crashDumps', join(userDataOverride, 'Crashpad'))
}
// Playwright's Electron loader adds --password-store=basic (meant for browsers it drives), which
// on Linux makes safeStorage use a hard-coded key, so the app keeps the session in memory only.
// End-to-end tests set TDC_E2E_REAL_KEYRING=1 to restore the normal keyring detection, so they
// cover the real keyring. Ignored in packaged builds.
if (process.env['TDC_E2E_REAL_KEYRING'] === '1' && !app.isPackaged) {
  app.commandLine.removeSwitch('password-store')
}

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

    // Updates are on in packaged builds whose format electron-updater can update (not in
    // invisible test runs, which stay off the network).
    const updatesEnabled = app.isPackaged && !invisibleForTests && autoUpdater.isUpdaterActive()
    const syncProxy = (proxy: string): void => {
      // electron-updater downloads through its own session.
      const sessions = [session.defaultSession, ...(updatesEnabled ? [autoUpdater.netSession] : [])]
      for (const target of sessions) {
        applyProxy(target, proxy).catch((error: unknown) => {
          logger.error('Could not apply the proxy setting', { error })
        })
      }
    }

    const initial = settings.get()
    logger.setLevel(is.dev ? 'debug' : initial.logging.level)
    nativeTheme.themeSource = initial.general.theme
    // The setting is the source of truth; re-apply it in case the OS entry was changed elsewhere.
    syncLoginItem(initial.general.launchAtLogin)
    syncProxy(initial.network.proxy)
    // Before any window exists, so crashes of every page process are covered.
    const crashReports = createCrashReports({
      crashReporter,
      dumpsDir: app.getPath('crashDumps'),
      logger: logger.child('crash')
    })
    if (initial.general.crashReports) crashReports.enable()
    settings.subscribe((next, previous) => {
      if (next.general.crashReports && !previous.general.crashReports) crashReports.enable()
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
    // Box art and reward images, fetched by main (the renderer's CSP allows no remote hosts).
    const images = createImageCache({
      index: storage.images,
      dir: join(app.getPath('userData'), 'images'),
      fetch: createNetFetch(net),
      clock: systemClock,
      logger: logger.child('images')
    })
    serveImages(images)
    const pruneImages = (): void => {
      images.prune().catch((error: unknown) => {
        logger.child('images').warn('Could not prune cached images', { error })
      })
    }

    purgeCache()
    pruneImages()
    const purgeTimer = setInterval(
      () => {
        purgeCache()
        pruneImages()
      },
      60 * 60 * 1000
    )
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

    // Main → renderer events go to the app window, validated against the contract.
    const events = createEventPublisher({
      target: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined),
      logger: logger.child('events')
    })
    auth.onChange((state) => events.publish('auth:state', state))

    // Online and awake? net.isOnline() is reliable when it says offline; power events cover sleep.
    const connectivity = createConnectivity({
      isOnline: () => net.isOnline(),
      power: {
        // One branch per event: powerMonitor's typings overload on the literal event name.
        on(event, listener) {
          if (event === 'suspend') {
            powerMonitor.on('suspend', listener)
            return () => powerMonitor.off('suspend', listener)
          }
          powerMonitor.on('resume', listener)
          return () => powerMonitor.off('resume', listener)
        }
      },
      scheduler: systemScheduler,
      logger: logger.child('connectivity')
    })
    connectivity.start()
    app.on('will-quit', () => connectivity.stop())

    // The miner runs while signed in. Not in probe mode: the probe promises read-only queries.
    const probeMode = process.env['TDC_DEV_GQL_PROBE'] !== undefined && !app.isPackaged
    // Invisible e2e runs log notifications instead of showing them, so tests don't pop anything
    // up on the developer's desktop; the tests read them from the log.
    const notify = (note: { title: string; body: string; onClick?: () => void }): void => {
      if (invisibleForTests) {
        logger.info('Notification', { title: note.title, body: note.body })
        return
      }
      if (!Notification.isSupported()) return
      const notification = new Notification({ title: note.title, body: note.body })
      if (note.onClick) notification.on('click', note.onClick)
      notification.show()
    }

    const mining = probeMode
      ? undefined
      : createMiningRuntime({
          http,
          auth,
          settings,
          storage,
          endpoints,
          connect: (url) => new WebSocket(url),
          connectivity,
          onClaim: (notice) => {
            if (!settings.get().general.trayNotifications) return
            notify({
              title: `Drop claimed: ${notice.gameName}`,
              body: notice.rewards.join(', ') || notice.dropName
            })
          },
          logger: logger.child('mining')
        })
    const stoppedView: MinerView = { status: 'stopped', wanted: [], channels: [], campaigns: [] }
    const minerView = (): MinerView => mining?.view() ?? stoppedView

    // The tray keeps the app reachable while the window is hidden. Not in invisible e2e runs, so
    // tests don't put an icon on the developer's taskbar; those runs act as if the tray exists.
    const toggleWindow = (): void => {
      if (mainWindow?.isVisible()) mainWindow.hide()
      else focusMainWindow()
    }
    const tray = invisibleForTests
      ? undefined
      : createAppTray({
          Tray,
          Menu,
          nativeImage,
          icon: nativeImage.createFromPath(icon),
          platform: process.platform,
          windowVisible: () => mainWindow?.isVisible() ?? false,
          onAction: (action) => {
            if (action === 'toggleWindow') toggleWindow()
            else if (action === 'reload') mining?.reload()
            else app.quit()
          }
        })
    tray?.update(minerView())
    hideOnClose = () =>
      settings.get().general.closeToTray && (tray !== undefined || invisibleForTests)
    onWindowVisibility = () => tray?.refresh()
    app.on('before-quit', () => {
      quitting = true
    })
    app.on('will-quit', () => tray?.destroy())

    if (mining) {
      mining.onChange(
        throttle(() => {
          const view = mining.view()
          events.publish('miner:state', view)
          tray?.update(view)
        }, 250)
      )
      app.on('before-quit', () => void mining.stop())
    }

    // App updates from GitHub Releases, following the updates settings. See docs/decisions.md.
    const updater = createUpdater({
      engine: updatesEnabled
        ? createElectronUpdateEngine({ updater: autoUpdater, logger: logger.child('updates') })
        : undefined,
      currentVersion: app.getVersion(),
      settings,
      clock: systemClock,
      logger: logger.child('updates'),
      // The window shows its own banner; a notification only while it's hidden.
      onNews: ({ kind, version }) => {
        if (mainWindow?.isVisible() || !settings.get().general.trayNotifications) return
        notify({
          title:
            kind === 'ready'
              ? `Twitch Drop Collector ${version} is ready to install`
              : `Twitch Drop Collector ${version} is available`,
          body:
            kind === 'ready' ? 'It installs when you quit, or restart now from the window.' : '',
          onClick: focusMainWindow
        })
      },
      beforeInstall: () => {
        quitting = true
      }
    })
    updater.onChange((view) => events.publish('updates:state', view))
    updater.start()
    app.on('will-quit', () => updater.stop())

    registerInvokeRoute(
      ipcMain,
      createInvokeRouter({
        handlers: createInvokeHandlers({
          app,
          shell,
          platform: process.platform,
          logsFolder: logsFolder(),
          settings,
          auth,
          miner: {
            view: minerView,
            reload: () => mining?.reload(),
            selectChannel: (channelId) => mining?.selectChannel(channelId)
          },
          updates: updater
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

    // Dev-only: TDC_DEV_GQL_PROBE=1 runs read-only GQL queries on the saved session, saves the
    // raw responses under userData/gql-probe, then quits. Ignored in packaged builds.
    // TDC_DEV_GQL_PROBE=loginWindow first signs in through the login window (Android app client).
    const probe = process.env['TDC_DEV_GQL_PROBE']
    if ((probe === '1' || probe === 'loginWindow') && !app.isPackaged) {
      const signInFirst =
        probe === 'loginWindow'
          ? auth.start().then(() => auth.signIn('loginWindow'))
          : Promise.resolve()
      void signInFirst
        .then(() =>
          runGqlProbe({
            auth,
            http,
            gqlUrl: endpoints.gql,
            outDir: join(app.getPath('userData'), 'gql-probe'),
            logger: logger.child('probe')
          })
        )
        .catch((error: unknown) => logger.error('GQL probe failed', { error }))
        .finally(() => app.quit())
    }

    // macOS: the dock icon shows the window again, re-creating it if none is open.
    app.on('activate', focusMainWindow)
  })().catch((error: unknown) => {
    logger.error('Startup failed', { error })
    dialog.showErrorBox(
      'Twitch Drop Collector could not start',
      error instanceof NewerDatabaseError
        ? 'Your data was saved by a newer version of Twitch Drop Collector. Install the latest ' +
            'version to keep using it; this version leaves your data untouched.'
        : String(error)
    )
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
