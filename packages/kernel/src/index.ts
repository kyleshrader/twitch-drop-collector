// Shared kernel: cross-cutting types every non-UI package may use. Imports nothing from the
// workspace, and no runtime APIs (Node, DOM, Electron), so it runs anywhere.
export type { Clock } from './clock'
export { systemClock } from './clock'
export type { LogFields, Logger, LogLevel } from './logger'
