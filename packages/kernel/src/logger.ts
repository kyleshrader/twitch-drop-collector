export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export type LogFields = Record<string, unknown>

/** Implemented in apps/desktop (electron-log); packages only see this interface. */
export interface Logger {
  error(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  /** A logger whose messages are tagged with `scope` (e.g. logger.child('gql')). */
  child(scope: string): Logger
}
