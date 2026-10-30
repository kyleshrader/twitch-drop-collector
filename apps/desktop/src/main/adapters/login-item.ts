// Launch at login. Windows and macOS go through app.setLoginItemSettings; Linux has no Electron
// API, so it gets an XDG autostart .desktop file.
import type { App } from 'electron'
import type { Logger } from '@tdc/kernel'
import { join } from 'node:path'

/** Passed to the app when the OS starts it at login (Windows and Linux). */
export const AUTOSTART_ARG = '--autostart'

export interface LoginItem {
  setEnabled(enabled: boolean): Promise<void>
  /** True when this launch came from the OS login item. */
  launchedAtLogin(): boolean
}

export interface LoginItemDeps {
  app: Pick<App, 'isPackaged' | 'setLoginItemSettings' | 'getLoginItemSettings'>
  platform: NodeJS.Platform
  argv: readonly string[]
  execPath: string
  env: Readonly<Record<string, string | undefined>>
  homedir: string
  desktopFileName: string
  productName: string
  fs: {
    mkdir(path: string, options: { recursive: true }): Promise<unknown>
    writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
    rm(path: string, options: { force: true }): Promise<void>
  }
  logger: Logger
}

/** Quotes a path for a .desktop Exec line (freedesktop Desktop Entry spec). */
function quoteExec(path: string): string {
  return `"${path.replace(/(["`$\\])/g, '\\$1')}"`
}

export function linuxAutostartFile(
  deps: Pick<LoginItemDeps, 'env' | 'homedir' | 'desktopFileName'>
): string {
  const configHome = deps.env['XDG_CONFIG_HOME'] || join(deps.homedir, '.config')
  return join(configHome, 'autostart', deps.desktopFileName)
}

export function linuxDesktopEntry(
  deps: Pick<LoginItemDeps, 'env' | 'execPath' | 'productName'>
): string {
  // Inside an AppImage, execPath points into the temporary mount; APPIMAGE is the real file.
  const executable = deps.env['APPIMAGE'] || deps.execPath
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${deps.productName}`,
    `Exec=${quoteExec(executable)} ${AUTOSTART_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    'Terminal=false',
    ''
  ].join('\n')
}

export function createLoginItem(deps: LoginItemDeps): LoginItem {
  const { app, platform, argv, fs, logger } = deps

  return {
    async setEnabled(enabled): Promise<void> {
      if (!app.isPackaged) {
        // An unpackaged build would register the bare Electron binary, which can't start the app.
        logger.info('Skipping launch-at-login registration in an unpackaged build', { enabled })
        return
      }
      if (platform === 'win32') {
        app.setLoginItemSettings({ openAtLogin: enabled, args: [AUTOSTART_ARG] })
      } else if (platform === 'darwin') {
        app.setLoginItemSettings({ openAtLogin: enabled })
      } else {
        const file = linuxAutostartFile(deps)
        if (enabled) {
          await fs.mkdir(join(file, '..'), { recursive: true })
          await fs.writeFile(file, linuxDesktopEntry(deps), 'utf8')
        } else {
          await fs.rm(file, { force: true })
        }
      }
      logger.info('Launch at login updated', { enabled })
    },
    launchedAtLogin(): boolean {
      if (argv.includes(AUTOSTART_ARG)) return true
      return platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
    }
  }
}
