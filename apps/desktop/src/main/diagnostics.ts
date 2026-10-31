// Errors and crashes from every process end up in the log. Crash dumps are written only once the
// user has opted in, and stay on this computer (docs/decisions.md).
import type { App, CrashReporter, WebContents } from 'electron'
import type { Logger } from '@tdc/kernel'

export const errorFields = (error: unknown): Record<string, unknown> =>
  error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) }

/**
 * Main-process errors, renderer and child-process crashes, and errors the app's own pages print.
 * Other pages (Twitch's sign-in page) report only crashes: their console is theirs.
 */
export function watchProcesses(deps: {
  app: Pick<App, 'on'>
  process: Pick<NodeJS.Process, 'on'>
  isAppPage: (contents: WebContents) => boolean
  logger: Logger
}): void {
  const { logger } = deps
  deps.process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in main', errorFields(error))
  })
  deps.process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection in main', errorFields(reason))
  })

  deps.app.on('render-process-gone', (_event, contents, details) => {
    logger.error('A page process ended', {
      url: contents.getURL().split(/[?#]/)[0],
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  deps.app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    logger.error('A helper process ended', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.name ? { name: details.name } : {})
    })
  })

  deps.app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_e, preloadPath, error) => {
      logger.error('Preload script failed', { preload: preloadPath, ...errorFields(error) })
    })
    contents.on('unresponsive', () => {
      logger.warn('A page stopped responding', { url: contents.getURL().split(/[?#]/)[0] })
    })
    contents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
      if (level !== 'error' || !deps.isAppPage(contents)) return
      logger.error('Error in the app window', { message, source: `${sourceId}:${lineNumber}` })
    })
  })
}

/**
 * Starts Electron's crash reporter without uploads. It can't be stopped once started, so turning
 * the setting off takes effect at the next launch.
 */
export function createCrashReports(deps: {
  crashReporter: Pick<CrashReporter, 'start'>
  dumpsDir: string
  logger: Logger
}): { enable(): void; enabled(): boolean } {
  let started = false
  return {
    enable() {
      if (started) return
      started = true
      deps.crashReporter.start({ uploadToServer: false, compress: true })
      deps.logger.info('Crash reports are on; dumps stay on this computer', {
        folder: deps.dumpsDir
      })
    },
    enabled: () => started
  }
}
