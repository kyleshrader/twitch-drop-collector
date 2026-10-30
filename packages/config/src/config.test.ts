import type { Logger } from '@tdc/kernel'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from './schema'
import { createSettingsService, type SettingsStore } from './service'
import { loadSettingsFile, migrate } from './stored'

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

function memoryStore(initial?: unknown): SettingsStore & { writes: unknown[] } {
  let data = initial
  const writes: unknown[] = []
  return {
    writes,
    read: async () => (data === undefined ? undefined : structuredClone(data)),
    write: async (next): Promise<void> => {
      writes.push(structuredClone(next))
      data = structuredClone(next)
    }
  }
}

describe('loadSettingsFile', () => {
  it('uses the defaults when there is no file', () => {
    expect(loadSettingsFile(undefined)).toEqual({ settings: DEFAULT_SETTINGS, problems: [] })
  })

  it('keeps valid values and fills in missing ones', () => {
    const { settings, problems } = loadSettingsFile({
      version: SETTINGS_VERSION,
      settings: { mining: { priority: ['Rust'], priorityMode: 'endingSoonest' } }
    })
    expect(problems).toEqual([])
    expect(settings.mining.priority).toEqual(['Rust'])
    expect(settings.mining.priorityMode).toBe('endingSoonest')
    expect(settings.general).toEqual(DEFAULT_SETTINGS.general)
  })

  it('resets only the invalid fields', () => {
    const { settings, problems } = loadSettingsFile({
      version: SETTINGS_VERSION,
      settings: {
        general: { theme: 'neon', trayNotifications: false },
        network: { connectionQuality: 99, proxy: 'ftp://nope' }
      }
    })
    expect(settings.general.theme).toBe('system')
    expect(settings.general.trayNotifications).toBe(false)
    expect(settings.network).toEqual(DEFAULT_SETTINGS.network)
    expect(problems).toEqual([
      'general.theme was invalid and has been reset to its default',
      'network.proxy was invalid and has been reset to its default',
      'network.connectionQuality was invalid and has been reset to its default'
    ])
  })

  it.each([null, 'text', [], 42])('falls back to defaults for a %j file', (raw) => {
    const { settings, problems } = loadSettingsFile(raw)
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(problems.length).toBeGreaterThan(0)
  })

  it('drops unknown fields, including ones from a newer version', () => {
    const { settings, problems } = loadSettingsFile({
      version: SETTINGS_VERSION + 1,
      settings: { general: { launchAtLogin: true, futureFlag: true }, futureSection: {} }
    })
    expect(settings.general.launchAtLogin).toBe(true)
    expect(settings).not.toHaveProperty('futureSection')
    expect(settings.general).not.toHaveProperty('futureFlag')
    expect(problems[0]).toMatch(/newer version/)
  })
})

describe('migrate', () => {
  it('runs each migration step from the file version up to the target', () => {
    const migrations = {
      1: (s: Record<string, unknown>): Record<string, unknown> => ({ ...s, step1: true }),
      2: (s: Record<string, unknown>): Record<string, unknown> => ({ ...s, step2: true })
    }
    expect(migrate({ version: 1, settings: { a: 1 } }, migrations, 3)).toEqual({
      settings: { a: 1, step1: true, step2: true },
      problems: []
    })
    expect(migrate({ version: 2, settings: {} }, migrations, 3).settings).toEqual({ step2: true })
  })
})

describe('settings service', () => {
  it('starts from the stored file', async () => {
    const store = memoryStore({
      version: SETTINGS_VERSION,
      settings: { logging: { level: 'debug' } }
    })
    const service = await createSettingsService({ store, logger: testLogger() })
    expect(service.get().logging.level).toBe('debug')
    expect(store.writes).toEqual([])
  })

  it('rewrites a repaired file once and logs what it fixed', async () => {
    const store = memoryStore({ version: SETTINGS_VERSION, settings: { general: { theme: 'x' } } })
    const logger = testLogger()
    await createSettingsService({ store, logger })
    expect(logger.warn).toHaveBeenCalledWith(
      'general.theme was invalid and has been reset to its default'
    )
    expect(store.writes).toEqual([{ version: SETTINGS_VERSION, settings: DEFAULT_SETTINGS }])
  })

  it('persists updates, then notifies subscribers', async () => {
    const store = memoryStore()
    const service = await createSettingsService({ store, logger: testLogger() })
    const listener = vi.fn()
    service.subscribe(listener)

    const next = await service.update({ general: { launchAtLogin: true } })

    expect(next.general.launchAtLogin).toBe(true)
    expect(next.general.trayNotifications).toBe(true)
    expect(store.writes).toEqual([{ version: SETTINGS_VERSION, settings: next }])
    expect(listener).toHaveBeenCalledWith(next, DEFAULT_SETTINGS)
  })

  it('skips the write when nothing changed', async () => {
    const store = memoryStore()
    const service = await createSettingsService({ store, logger: testLogger() })
    await service.update({ general: { launchAtLogin: false } })
    expect(store.writes).toEqual([])
  })

  it.each([
    { general: { theme: 'neon' } },
    { network: { connectionQuality: 0 } },
    { network: { proxy: 'not a url' } },
    { mining: { priority: [''] } },
    { general: { unknownKey: true } },
    { unknownSection: {} }
  ])('rejects the invalid patch %j without writing', async (patch) => {
    const store = memoryStore()
    const service = await createSettingsService({ store, logger: testLogger() })
    await expect(service.update(patch as never)).rejects.toThrow()
    expect(store.writes).toEqual([])
    expect(service.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps the old settings when the write fails', async () => {
    const store = memoryStore()
    store.write = async (): Promise<void> => {
      throw new Error('disk full')
    }
    const service = await createSettingsService({ store, logger: testLogger() })
    await expect(service.update({ general: { launchAtLogin: true } })).rejects.toThrow('disk full')
    expect(service.get().general.launchAtLogin).toBe(false)
  })

  it('applies concurrent updates in call order', async () => {
    const store = memoryStore()
    const service = await createSettingsService({ store, logger: testLogger() })
    const results = await Promise.all([
      service.update({ network: { connectionQuality: 2 } }),
      service.update({ network: { connectionQuality: 3 } }),
      service.update({ mining: { enableBadgesEmotes: true } })
    ])
    const final: Settings = results[2]
    expect(final.network.connectionQuality).toBe(3)
    expect(final.mining.enableBadgesEmotes).toBe(true)
    expect(store.writes.at(-1)).toEqual({ version: SETTINGS_VERSION, settings: final })
  })

  it('keeps notifying other listeners when one throws', async () => {
    const logger = testLogger()
    const service = await createSettingsService({ store: memoryStore(), logger })
    const second = vi.fn()
    service.subscribe(() => {
      throw new Error('boom')
    })
    service.subscribe(second)
    await service.update({ general: { trayNotifications: false } })
    expect(second).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })
})
