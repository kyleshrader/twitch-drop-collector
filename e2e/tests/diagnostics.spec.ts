// M9: a forced error in each process ends up in the log file, and crash dumps are kept only when
// the user has turned crash reports on.
import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, newUserDataDir } from './app'

const logOf = (userDataDir: string) => (): string => {
  const file = join(userDataDir, 'logs', 'main.log')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}
const dumpsIn = (userDataDir: string) => (): number =>
  filesUnder(join(userDataDir, 'Crashpad')).filter((f) => /\.dmp$/i.test(f)).length

const crashRenderer = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
  )

test('errors in main and in the window are written to the log file', async () => {
  const { app, window: page, userDataDir } = await launchApp()
  const log = logOf(userDataDir)
  try {
    await app.evaluate(() => {
      setTimeout(() => {
        throw new Error('forced main error')
      })
    })
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('forced renderer error')
      })
    })
    await expect.poll(log).toContain('forced main error')
    await expect.poll(log).toContain('forced renderer error')
    expect(log()).toContain('[error] [process] Uncaught exception in main')
    expect(log()).toContain('[error] [process] Error in the app window')
  } finally {
    await app.close()
  }
})

/** Crashes the main process for real (killing a page process doesn't make a dump). */
async function crashMain(app: Awaited<ReturnType<typeof launchApp>>['app']): Promise<void> {
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await app.evaluate(() => setTimeout(() => process.crash())).catch(() => {})
  await exited
}

test('without consent, a crash leaves no dump', async () => {
  const { app, userDataDir } = await launchApp()
  await crashMain(app)
  // Give a crash handler, if one were running, time to write.
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  expect(dumpsIn(userDataDir)()).toBe(0)
  expect(logOf(userDataDir)()).not.toContain('Crash reports are on')
})

test('a crashed window is logged and reloaded', async () => {
  const { app, userDataDir } = await launchApp()
  const log = logOf(userDataDir)
  try {
    await crashRenderer(app)
    await expect.poll(log).toContain('A page process ended')
    expect(log()).toMatch(/reason: '(crashed|killed)'/)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.webContents.isCrashed()
        )
      )
      .toBe(false)
  } finally {
    await app.close()
  }
})

test('with crash reports on, a crash leaves a dump on this computer', async () => {
  const userDataDir = newUserDataDir()
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 1, settings: { general: { crashReports: true } } })
  )
  const { app } = await launchApp(userDataDir)
  await expect.poll(logOf(userDataDir)).toContain('Crash reports are on')
  await crashMain(app)
  await expect.poll(dumpsIn(userDataDir), { timeout: 15_000 }).toBeGreaterThan(0)
})
