import type { Logger } from '@tdc/kernel'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createJsonFileStore } from './json-file-store'
import {
  AUTOSTART_ARG,
  createLoginItem,
  linuxAutostartFile,
  linuxDesktopEntry,
  type LoginItemDeps
} from './login-item'

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

describe('json file store', () => {
  const newFile = async (): Promise<string> =>
    join(await mkdtemp(join(tmpdir(), 'tdc-store-')), 'nested', 'settings.json')

  it('reads nothing before the first write, then round-trips', async () => {
    const store = createJsonFileStore({ file: await newFile(), logger: testLogger() })
    expect(await store.read()).toBeUndefined()
    await store.write({ version: 1, settings: { a: [1, 2] } })
    expect(await store.read()).toEqual({ version: 1, settings: { a: [1, 2] } })
  })

  it('leaves no temp file behind', async () => {
    const file = await newFile()
    const store = createJsonFileStore({ file, logger: testLogger() })
    await store.write({ one: 1 })
    await store.write({ two: 2 })
    expect(await readdir(join(file, '..'))).toEqual(['settings.json'])
  })

  it('moves a corrupt file aside and reports no data', async () => {
    const file = await newFile()
    const store = createJsonFileStore({
      file,
      logger: testLogger(),
      now: () => new Date('2026-10-30T12:00:00.000Z')
    })
    await store.write({})
    await writeFile(file, '{ not json', 'utf8')

    expect(await store.read()).toBeUndefined()
    const backup = `${file}.corrupt-2026-10-30T12-00-00-000Z`
    expect(await readFile(backup, 'utf8')).toBe('{ not json')
    expect(await store.read()).toBeUndefined()
  })
})

describe('login item', () => {
  function setup(overrides: Partial<LoginItemDeps> = {}): {
    item: ReturnType<typeof createLoginItem>
    deps: LoginItemDeps
    setLoginItemSettings: ReturnType<typeof vi.fn>
    files: Map<string, string>
  } {
    const files = new Map<string, string>()
    const setLoginItemSettings = vi.fn()
    const deps: LoginItemDeps = {
      app: {
        isPackaged: true,
        setLoginItemSettings,
        getLoginItemSettings: () => ({ wasOpenedAtLogin: false }) as never
      },
      platform: 'win32',
      argv: ['app.exe'],
      execPath: 'C:\\Program Files\\Twitch Drop Collector\\app.exe',
      env: {},
      homedir: '/home/kyle',
      desktopFileName: 'twitch-drop-collector.desktop',
      productName: 'Twitch Drop Collector',
      fs: {
        mkdir: async () => undefined,
        writeFile: async (path, data) => {
          files.set(path, data)
        },
        rm: async (path) => {
          files.delete(path)
        }
      },
      logger: testLogger(),
      ...overrides
    }
    return { item: createLoginItem(deps), deps, setLoginItemSettings, files }
  }

  it('registers on Windows with the autostart argument', async () => {
    const { item, setLoginItemSettings } = setup()
    await item.setEnabled(true)
    await item.setEnabled(false)
    expect(setLoginItemSettings.mock.calls).toEqual([
      [{ openAtLogin: true, args: [AUTOSTART_ARG] }],
      [{ openAtLogin: false, args: [AUTOSTART_ARG] }]
    ])
  })

  it('registers on macOS without arguments', async () => {
    const { item, setLoginItemSettings } = setup({ platform: 'darwin' })
    await item.setEnabled(true)
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('writes and removes an XDG autostart entry on Linux', async () => {
    const { item, files, deps } = setup({
      platform: 'linux',
      execPath: '/opt/Twitch Drop Collector/twitch-drop-collector'
    })
    const path = linuxAutostartFile(deps)
    expect(path).toBe(join('/home/kyle', '.config', 'autostart', 'twitch-drop-collector.desktop'))

    await item.setEnabled(true)
    expect(files.get(path)).toContain(
      `Exec="/opt/Twitch Drop Collector/twitch-drop-collector" ${AUTOSTART_ARG}`
    )
    await item.setEnabled(false)
    expect(files.has(path)).toBe(false)
  })

  it('respects XDG_CONFIG_HOME and points AppImages at the AppImage file', () => {
    const deps = {
      env: { XDG_CONFIG_HOME: '/cfg', APPIMAGE: '/home/kyle/Apps/TDC.AppImage' },
      homedir: '/home/kyle',
      desktopFileName: 'tdc.desktop',
      execPath: '/tmp/.mount_TDC/tdc',
      productName: 'Twitch Drop Collector'
    }
    expect(linuxAutostartFile(deps)).toBe(join('/cfg', 'autostart', 'tdc.desktop'))
    expect(linuxDesktopEntry(deps)).toContain('Exec="/home/kyle/Apps/TDC.AppImage" --autostart')
  })

  it('escapes quotes and dollar signs in the Exec path', () => {
    expect(
      linuxDesktopEntry({ env: {}, execPath: '/opt/a "b" $c/app', productName: 'X' })
    ).toContain('Exec="/opt/a \\"b\\" \\$c/app" --autostart')
  })

  it('never registers an unpackaged build', async () => {
    const { item, setLoginItemSettings, files } = setup({
      app: {
        isPackaged: false,
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn() as never
      }
    })
    await item.setEnabled(true)
    expect(setLoginItemSettings).not.toHaveBeenCalled()
    expect(files.size).toBe(0)
  })

  it('detects a launch at login', () => {
    expect(setup({ argv: ['app.exe', AUTOSTART_ARG] }).item.launchedAtLogin()).toBe(true)
    expect(setup().item.launchedAtLogin()).toBe(false)
    expect(
      setup({
        platform: 'darwin',
        app: {
          isPackaged: true,
          setLoginItemSettings: vi.fn(),
          getLoginItemSettings: () => ({ wasOpenedAtLogin: true }) as never
        }
      }).item.launchedAtLogin()
    ).toBe(true)
  })
})
