// Temporary console-backed Logger until electron-log is wired in at M9.
import type { LogFields, Logger, LogLevel } from '@tdc/kernel'

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

export function createConsoleLogger(options: { level: LogLevel; scope?: string }): Logger {
  const { level, scope } = options
  const prefix = scope ? `[${scope}]` : ''

  const write =
    (at: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (RANK[at] > RANK[level]) return
      const line = [`${at.toUpperCase()}${prefix}`, message]
      if (fields) console[at === 'debug' ? 'log' : at](...line, fields)
      else console[at === 'debug' ? 'log' : at](...line)
    }

  return {
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
    child: (child) => createConsoleLogger({ level, scope: scope ? `${scope}:${child}` : child })
  }
}
