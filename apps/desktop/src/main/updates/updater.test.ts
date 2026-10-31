import { createSettingsService, type SettingsService } from '@tdc/config'
import type { Logger } from '@tdc/kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpdater, type UpdateEngine } from './updater'

function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

function fakeEngine(feed: { version?: string } = { version: '1.1.0' }) {
  let finishDownload: (() => void) | undefined
  const engine = {
    configure: vi.fn<UpdateEngine['configure']>(),
    check: vi.fn(async () => feed.version),
    download: vi.fn(
      (onProgress: (percent: number) => void) =>
        new Promise<void>((resolve) => {
          onProgress(40)
          finishDownload = resolve
        })
    ),
    quitAndInstall: vi.fn()
  } satisfies UpdateEngine
  return { engine, feed, finishDownload: () => finishDownload?.() }
}

async function setup(
  options: {
    mode?: 'auto' | 'notify' | 'off'
    skippedVersion?: string
    feed?: { version?: string }
    noEngine?: boolean
  } = {}
) {
  const settings: SettingsService = await createSettingsService({
    store: { read: async () => undefined, write: async () => undefined },
    logger: testLogger()
  })
  await settings.update({
    updates: { mode: options.mode ?? 'notify', skippedVersion: options.skippedVersion ?? '' }
  })
  const fake = fakeEngine(options.feed)
  const onNews = vi.fn()
  const beforeInstall = vi.fn()
  const updater = createUpdater({
    engine: options.noEngine ? undefined : fake.engine,
    currentVersion: '1.0.0',
    settings,
    clock: { now: () => new Date('2026-10-31T12:00:00Z') },
    logger: testLogger(),
    onNews,
    beforeInstall,
    firstCheckMs: 1_000,
    checkEveryMs: 10_000
  })
  return { updater, settings, onNews, beforeInstall, ...fake }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('updater', () => {
  it('is unsupported without an engine', async () => {
    const { updater } = await setup({ noEngine: true })
    expect((await updater.check({ manual: true })).status).toBe('unsupported')
    expect(updater.install()).toBe(false)
  })

  it('reports up to date', async () => {
    const { updater } = await setup({ feed: {} })
    const view = await updater.check()
    expect(view).toMatchObject({ status: 'upToDate', currentVersion: '1.0.0' })
    expect(view.lastChecked).toBe(Date.parse('2026-10-31T12:00:00Z'))
  })

  it('in notify mode offers the update and downloads only when asked', async () => {
    const { updater, engine, onNews, finishDownload } = await setup()
    const offered = await updater.check()
    expect(offered).toMatchObject({ status: 'available', version: '1.1.0', dismissed: false })
    expect(engine.download).not.toHaveBeenCalled()
    expect(onNews).toHaveBeenCalledWith({ kind: 'available', version: '1.1.0' })

    const downloading = updater.download()
    expect(updater.view()).toMatchObject({ status: 'downloading', percent: 40 })
    finishDownload()
    expect(await downloading).toMatchObject({ status: 'ready', version: '1.1.0' })
    expect(onNews).toHaveBeenCalledWith({ kind: 'ready', version: '1.1.0' })
    expect(engine.configure).toHaveBeenLastCalledWith({ prereleases: false, installOnQuit: true })
  })

  it('in auto mode downloads by itself and announces only the ready update', async () => {
    const { updater, engine, onNews, finishDownload } = await setup({ mode: 'auto' })
    const checking = updater.check()
    await vi.waitFor(() => expect(engine.download).toHaveBeenCalled())
    finishDownload()
    expect(await checking).toMatchObject({ status: 'ready', version: '1.1.0' })
    expect(onNews).toHaveBeenCalledTimes(1)
    expect(onNews).toHaveBeenCalledWith({ kind: 'ready', version: '1.1.0' })
  })

  it('installs only a ready update, after letting the window close', async () => {
    const { updater, engine, beforeInstall, finishDownload } = await setup()
    await updater.check()
    expect(updater.install()).toBe(false)
    const downloading = updater.download()
    finishDownload()
    await downloading
    expect(updater.install()).toBe(true)
    expect(beforeInstall).toHaveBeenCalledBefore(engine.quitAndInstall)
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('Later hides the offer from automatic checks of the same version only', async () => {
    const { updater, feed } = await setup()
    await updater.check()
    expect(updater.dismiss().dismissed).toBe(true)
    expect((await updater.check()).dismissed).toBe(true)
    expect((await updater.check({ manual: true })).dismissed).toBe(false)
    updater.dismiss()
    feed.version = '1.2.0'
    expect(await updater.check()).toMatchObject({ version: '1.2.0', dismissed: false })
  })

  it('a skipped version is saved, not offered automatically, and not auto-downloaded', async () => {
    const { updater, settings, engine, onNews } = await setup()
    await updater.check()
    expect(await updater.skip()).toMatchObject({ skipped: true, dismissed: true })
    expect(settings.get().updates.skippedVersion).toBe('1.1.0')

    await settings.update({ updates: { mode: 'auto' } })
    expect(await updater.check()).toMatchObject({ status: 'available', dismissed: true })
    expect(engine.download).not.toHaveBeenCalled()
    expect(onNews).toHaveBeenCalledTimes(1)
    // Check for updates still shows it.
    expect(await updater.check({ manual: true })).toMatchObject({ skipped: true, dismissed: false })
  })

  it('does not install a skipped version on quit', async () => {
    const { updater, engine, finishDownload } = await setup()
    await updater.check()
    const downloading = updater.download()
    finishDownload()
    await downloading
    await updater.skip()
    expect(engine.configure).toHaveBeenLastCalledWith({ prereleases: false, installOnQuit: false })
  })

  it('reports a failed check and a failed download', async () => {
    const { updater, engine } = await setup()
    engine.check.mockRejectedValueOnce(new Error('HttpError: 404\nlong body'))
    expect(await updater.check()).toMatchObject({ status: 'error', error: 'HttpError: 404' })
    await updater.check()
    engine.download.mockRejectedValueOnce(new Error('disk full'))
    expect(await updater.download()).toMatchObject({ status: 'available', error: 'disk full' })
  })

  it('shares one check between concurrent callers', async () => {
    const { updater, engine } = await setup()
    await Promise.all([updater.check(), updater.check({ manual: true })])
    expect(engine.check).toHaveBeenCalledTimes(1)
  })

  it('checks on a timer unless the mode is off, and follows mode changes', async () => {
    vi.useFakeTimers()
    const { updater, settings, engine } = await setup({ mode: 'off' })
    updater.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.check).not.toHaveBeenCalled()

    await settings.update({ updates: { mode: 'notify' } })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(engine.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(engine.check).toHaveBeenCalledTimes(2)

    await settings.update({ updates: { prereleases: true } })
    expect(engine.configure).toHaveBeenLastCalledWith({ prereleases: true, installOnQuit: true })
    updater.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.check).toHaveBeenCalledTimes(2)
  })
})
