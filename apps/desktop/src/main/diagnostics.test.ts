import { EventEmitter } from 'node:events'
import type { App, WebContents } from 'electron'
import type { Logger } from '@tdc/kernel'
import { describe, expect, it, vi } from 'vitest'
import { createCrashReports, watchProcesses } from './diagnostics'
import { createAppLogger, type ElectronLogLike } from './logger'

function testLogger(): Logger & {
  error: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

function setup() {
  const app = new EventEmitter()
  const proc = new EventEmitter()
  const logger = testLogger()
  watchProcesses({
    app: app as unknown as Pick<App, 'on'>,
    process: proc as unknown as Pick<NodeJS.Process, 'on'>,
    isAppPage: (contents) => contents.getURL().startsWith('app://renderer/'),
    logger
  })
  const page = (url: string): EventEmitter & { getURL: () => string } => {
    const contents = Object.assign(new EventEmitter(), { getURL: () => url })
    app.emit('web-contents-created', {}, contents as unknown as WebContents)
    return contents
  }
  return { app, proc, logger, page }
}

describe('watchProcesses', () => {
  it('logs main-process errors and rejections with their stack', () => {
    const { proc, logger } = setup()
    proc.emit('uncaughtException', new Error('boom'))
    proc.emit('unhandledRejection', 'nope')
    expect(logger.error).toHaveBeenCalledWith(
      'Uncaught exception in main',
      expect.objectContaining({ error: 'boom', stack: expect.stringContaining('boom') })
    )
    expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection in main', {
      error: 'nope'
    })
  })

  it('logs errors printed by the app window, but not by other pages', () => {
    const { page, logger } = setup()
    const message = { level: 'error', message: 'Uncaught Error: x', sourceId: 's', lineNumber: 1 }
    page('app://renderer/index.html').emit('console-message', message)
    page('https://www.twitch.tv/login').emit('console-message', message)
    page('app://renderer/index.html').emit('console-message', { ...message, level: 'info' })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Error in the app window', {
      message: 'Uncaught Error: x',
      source: 's:1'
    })
  })

  it('logs crashed pages without their query string, and helper crashes', () => {
    const { app, logger } = setup()
    const contents = { getURL: () => 'https://www.twitch.tv/login?client_id=abc#token' }
    app.emit('render-process-gone', {}, contents, { reason: 'crashed', exitCode: 5 })
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 })
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 })
    expect(logger.error).toHaveBeenCalledWith('A page process ended', {
      url: 'https://www.twitch.tv/login',
      reason: 'crashed',
      exitCode: 5
    })
    expect(logger.error).toHaveBeenCalledWith('A helper process ended', {
      type: 'GPU',
      reason: 'crashed',
      exitCode: 1
    })
    expect(logger.error).toHaveBeenCalledTimes(2)
  })
})

describe('crash reports', () => {
  it('start once, without uploads, only when enabled', () => {
    const start = vi.fn()
    const reports = createCrashReports({
      crashReporter: { start },
      dumpsDir: '/profile/Crashpad',
      logger: testLogger()
    })
    expect(reports.enabled()).toBe(false)
    reports.enable()
    reports.enable()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ uploadToServer: false }))
    expect(reports.enabled()).toBe(true)
  })
})

describe('app logger', () => {
  function fakeLog(): ElectronLogLike & { lines: unknown[][] } {
    const lines: unknown[][] = []
    const write =
      (level: string) =>
      (...params: unknown[]): void => {
        lines.push([level, ...params])
      }
    return {
      lines,
      error: write('error'),
      warn: write('warn'),
      info: write('info'),
      debug: write('debug'),
      transports: {
        file: { level: 'info', maxSize: 0, format: '', resolvePathFn: () => '' },
        console: { level: 'info' }
      }
    }
  }

  it('writes scoped messages to the configured file and follows the level', () => {
    const log = fakeLog()
    const logger = createAppLogger({
      log,
      file: () => '/profile/logs/main.log',
      level: 'info',
      console: false
    })
    logger.child('mining').child('gql').warn('Slow', { ms: 900 })
    expect(log.lines).toEqual([['warn', '[mining:gql] Slow', { ms: 900 }]])
    expect(log.transports.file.resolvePathFn()).toBe('/profile/logs/main.log')
    expect(log.transports.file.maxSize).toBeGreaterThan(0)
    expect(log.transports.console.level).toBe(false)

    logger.setLevel('debug')
    expect(log.transports.file.level).toBe('debug')
  })
})
