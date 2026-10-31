// The app's Logger, written by electron-log to a rotating file (and the console in development).
// Packages only see @tdc/kernel's Logger interface.
import type { LogFields, Logger, LogLevel } from '@tdc/kernel'

export interface RootLogger extends Logger {
  /** Changes the level for this logger and every child created from it. */
  setLevel(level: LogLevel): void
}

/** The slice of electron-log's main logger this uses, so tests can pass a fake. */
export interface ElectronLogLike {
  error(...params: unknown[]): void
  warn(...params: unknown[]): void
  info(...params: unknown[]): void
  debug(...params: unknown[]): void
  // Wide enough for electron-log's own types, which know more levels and path arguments.
  transports: {
    file: {
      level: string | false
      maxSize: number
      format: unknown
      resolvePathFn: (...args: never[]) => string
    }
    console: { level: string | false }
  }
}

/** Rotated to main.old.log at this size, so at most twice this on disk. */
export const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024

export function createAppLogger(options: {
  log: ElectronLogLike
  /** Asked on every write, so it can follow a profile folder chosen after startup. */
  file: () => string
  level: LogLevel
  /** Also write to the console (development). */
  console: boolean
}): RootLogger {
  const { log } = options
  log.transports.file.resolvePathFn = options.file
  log.transports.file.maxSize = LOG_FILE_MAX_BYTES
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  const setLevel = (level: LogLevel): void => {
    log.transports.file.level = level
    log.transports.console.level = options.console ? level : false
  }
  setLevel(options.level)

  const scoped = (scope: string | undefined): Logger => {
    const prefix = scope ? `[${scope}] ` : ''
    const write =
      (at: LogLevel) =>
      (message: string, fields?: LogFields): void => {
        if (fields) log[at](`${prefix}${message}`, fields)
        else log[at](`${prefix}${message}`)
      }
    return {
      error: write('error'),
      warn: write('warn'),
      info: write('info'),
      debug: write('debug'),
      child: (child) => scoped(scope ? `${scope}:${child}` : child)
    }
  }

  return { ...scoped(undefined), setLevel }
}
