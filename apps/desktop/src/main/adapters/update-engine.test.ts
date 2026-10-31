import type { AppUpdater } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '@tdc/kernel'
import {
  createElectronUpdateEngine,
  describeUpdateError,
  isNothingPublished
} from './update-engine'

/** An error shaped like electron-updater's newError(). */
const updaterError = (message: string, code?: string): Error =>
  Object.assign(new Error(message), code ? { code } : {})

describe('describeUpdateError', () => {
  it.each([
    [
      '404 \n"method: GET url: https://github.com/o/r/releases.atom"',
      'no published releases were found'
    ],
    ['HttpError: 503 Service Unavailable\nbody', 'the update server answered 503'],
    ['net::ERR_INTERNET_DISCONNECTED', 'network error (net::ERR_INTERNET_DISCONNECTED)'],
    ['sha512 checksum mismatch, expected x\nmore', 'sha512 checksum mismatch, expected x']
  ])('%s', (message, expected) => {
    expect(describeUpdateError(new Error(message))).toBe(expected)
  })
})

describe('isNothingPublished', () => {
  it.each([
    [
      'update files still uploading',
      updaterError(
        'Cannot find latest.yml in the latest release artifacts (https://x/latest.yml): HttpError: 404',
        'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
      )
    ],
    [
      'no stable release while pre-releases are off',
      updaterError(
        'Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://x/releases/latest), please ensure a production release exists: HttpError: ',
        'ERR_UPDATER_INVALID_RELEASE_FEED'
      )
    ],
    [
      'no releases at all',
      updaterError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
    ],
    ['no releases feed', updaterError('404 \n"method: GET url: https://x/releases.atom"')]
  ])('%s', (_name, error) => {
    expect(isNothingPublished(error)).toBe(true)
  })

  it.each([
    ['a server error', updaterError('HttpError: 503 Service Unavailable')],
    ['a network error', updaterError('net::ERR_INTERNET_DISCONNECTED')],
    [
      'a broken feed',
      updaterError('Cannot parse releases feed: bad XML', 'ERR_UPDATER_INVALID_RELEASE_FEED')
    ]
  ])('not %s', (_name, error) => {
    expect(isNothingPublished(error)).toBe(false)
  })
})

describe('check', () => {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  const engineThatFails = (error: Error) =>
    createElectronUpdateEngine({
      updater: {
        on: vi.fn(),
        checkForUpdates: vi.fn().mockRejectedValue(error)
      } as unknown as AppUpdater,
      logger
    })

  it('reports no update while nothing is published', async () => {
    const engine = engineThatFails(
      updaterError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
    )
    await expect(engine.check()).resolves.toBeUndefined()
  })

  it('still fails on other errors', async () => {
    const engine = engineThatFails(updaterError('net::ERR_INTERNET_DISCONNECTED'))
    await expect(engine.check()).rejects.toThrow('network error (net::ERR_INTERNET_DISCONNECTED)')
  })
})
