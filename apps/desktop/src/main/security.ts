// App-wide hardening from the Electron security checklist, applied to every webContents.
import { app, net, protocol, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { IMAGE_ORIGIN, IMAGE_SCHEME } from '@tdc/ipc-contract'
import type { ImageCache } from './images/image-cache'
import {
  APP_HOST,
  APP_SCHEME,
  isSafeExternalUrl,
  isSameOrigin,
  remoteImageUrl,
  resolveRendererPath
} from './policy'

/** Must run before the app is ready, and only once: each call replaces the previous list. */
export function registerAppSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/**
 * Serves tdc-image://cache/?url=… from the image cache. Registered on the default session only,
 * so the sign-in window (its own partition) can't reach it.
 */
export function serveImages(cache: ImageCache): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const remote = request.method === 'GET' ? remoteImageUrl(request.url, IMAGE_ORIGIN) : null
    const image = remote ? await cache.get(remote) : undefined
    if (!image) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(image.body), {
      headers: {
        'content-type': image.contentType,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff'
      }
    })
  })
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
// Windows that show someone else's site (the Twitch login window) say where they may navigate.
const navigationAllowances = new WeakMap<Electron.WebContents, (url: string) => boolean>()

/** Lets one specific webContents navigate to URLs matching `allow`. */
export function allowNavigation(
  contents: Electron.WebContents,
  allow: (url: string) => boolean
): void {
  navigationAllowances.set(contents, allow)
}

export function hardenWebContents(rendererOrigin: string): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternally(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const allowance = navigationAllowances.get(contents)
      if (allowance ? allowance(url) : isSameOrigin(url, rendererOrigin)) return
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
