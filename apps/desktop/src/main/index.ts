import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createInvokeHandlers } from './ipc/handlers'
import { registerInvokeRoute } from './ipc/register'
import { createInvokeRouter } from './ipc/router'
import { createConsoleLogger } from './logger'
import { APP_ORIGIN, isSameOrigin, mainWindowOptions } from './policy'
import { hardenWebContents, registerAppScheme, serveRenderer } from './security'

const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererOrigin = devServerUrl ?? APP_ORIGIN
const logger = createConsoleLogger({ level: is.dev ? 'debug' : 'info' })

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...mainWindowOptions(join(__dirname, '../preload/index.js')),
    ...(process.platform === 'linux' ? { icon } : {})
  })

  window.on('ready-to-show', () => window.show())
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

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.github.twitchdropcollector')

    // F12 toggles DevTools in development; reload shortcuts are ignored in production.
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    serveRenderer(join(__dirname, '../renderer'))
    hardenWebContents(rendererOrigin)
    registerInvokeRoute(
      ipcMain,
      createInvokeRouter({
        handlers: createInvokeHandlers({ app, shell, platform: process.platform }),
        isTrustedSender: (url) => isSameOrigin(url, rendererOrigin),
        logger: logger.child('ipc')
      })
    )
    mainWindow = createWindow()

    // macOS: re-create the window when the dock icon is clicked and none are open.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
