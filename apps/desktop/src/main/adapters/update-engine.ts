// electron-updater behind the UpdateEngine interface. The updater decides when to download and
// install, so electron-updater's own automatic download stays off.
import type { AppUpdater, ProgressInfo } from 'electron-updater'
import type { Logger } from '@tdc/kernel'
import type { UpdateEngine } from '../updates/updater'

/** electron-updater's errors start with a bare status ("404 ") or a Chromium net error code. */
export function describeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = /^(?:HttpError: )?(\d{3})\b/.exec(message)?.[1]
  if (status === '404') return 'no published releases were found'
  if (status) return `the update server answered ${status}`
  const netError = /net::ERR_[A-Z_]+/.exec(message)?.[0]
  if (netError) return `network error (${netError})`
  return message.split('\n')[0]!.trim().slice(0, 200)
}

const withReadableErrors = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task()
  } catch (error) {
    throw new Error(describeUpdateError(error), { cause: error })
  }
}

export function createElectronUpdateEngine(deps: {
  updater: AppUpdater
  logger: Logger
}): UpdateEngine {
  const { updater, logger } = deps
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.logger = {
    info: (message?: unknown) => logger.debug(String(message)),
    warn: (message?: unknown) => logger.warn(String(message)),
    // Failures also reject the calls below, where the updater logs them once.
    error: (message?: unknown) => logger.debug(String(message)),
    debug: (message: string) => logger.debug(message)
  }
  // An 'error' event with no listener would throw.
  updater.on('error', () => {})

  return {
    configure({ prereleases, installOnQuit }) {
      updater.allowPrerelease = prereleases
      updater.autoInstallOnAppQuit = installOnQuit
    },
    check: () =>
      withReadableErrors(async () => {
        const result = await updater.checkForUpdates()
        return result?.isUpdateAvailable ? result.updateInfo.version : undefined
      }),
    download: (onProgress) =>
      withReadableErrors(async () => {
        const listener = (progress: ProgressInfo): void => onProgress(progress.percent)
        updater.on('download-progress', listener)
        try {
          await updater.downloadUpdate()
        } finally {
          updater.off('download-progress', listener)
        }
      }),
    // Not silent (the installer's progress shows), and start the new version afterwards.
    quitAndInstall: () => updater.quitAndInstall(false, true)
  }
}
