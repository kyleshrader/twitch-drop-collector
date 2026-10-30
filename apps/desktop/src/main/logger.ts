// Temporary console-backed Logger until electron-log is wired in at M9.
import type { LogFields, Logger, LogLevel } from '@tdc/kernel'

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

export interface RootLogger extends Logger {
  /** Changes the level for this logger and every child created from it. */
  setLevel(level: LogLevel): void
}

export function createConsoleLogger(options: { level: LogLevel }): RootLogger {
  const state = { level: options.level }

  const scoped = (scope: string | undefined): Logger => {
    const prefix = scope ? `[${scope}]` : ''
    const write =
      (at: LogLevel) =>
      (message: string, fields?: LogFields): void => {
        if (RANK[at] > RANK[state.level]) return
        const line = [`${at.toUpperCase()}${prefix}`, message]
        const method = at === 'debug' ? 'log' : at
        if (fields) console[method](...line, fields)
        else console[method](...line)
      }
    return {
      error: write('error'),
      warn: write('warn'),
      info: write('info'),
      debug: write('debug'),
      child: (child) => scoped(scope ? `${scope}:${child}` : child)
    }
  }

  return {
    ...scoped(undefined),
    setLevel: (level): void => {
      state.level = level
    }
  }
}
