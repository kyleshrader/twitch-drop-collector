// App-wide hardening from the Electron security checklist, applied to every webContents.
import { app, net, protocol, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import {
  APP_HOST,
  APP_SCHEME,
  isSafeExternalUrl,
  isSameOrigin,
  resolveRendererPath
} from './policy'

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Serves the built renderer from app://renderer/ instead of file://. */
export function serveRenderer(rendererDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = url.host === APP_HOST && resolveRendererPath(rendererDir, url.pathname)
    if (!file) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

function openExternally(url: string): void {
  if (isSafeExternalUrl(url)) void shell.openExternal(url)
}

/** Denies new windows, off-origin navigation, webviews and all permission requests. */
export function hardenWebContents(rendererOrigin: string): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternally(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isSameOrigin(url, rendererOrigin)) return
      event.preventDefault()
      openExternally(url)
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}
