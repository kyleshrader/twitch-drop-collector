// M8: the app keeps running in the background. Closing the window hides it to the tray (unless
// turned off), and mining pauses while the computer sleeps, then resumes with a fresh reload.
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch } from './mock-twitch'

const windowState = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      destroyed: w.isDestroyed()
    }))
  )

test('closing the window hides it and keeps the app running', async () => {
  const { app } = await launchApp()
  try {
    await expect.poll(() => windowState(app)).toEqual([{ visible: true, destroyed: false }])
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect.poll(() => windowState(app)).toEqual([{ visible: false, destroyed: false }])

    // A second launch brings it back, as the tray's "Show window" does.
    await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'))
    await expect.poll(() => windowState(app)).toEqual([{ visible: true, destroyed: false }])
  } finally {
    await app.close()
  }
})

test('with close-to-tray off, closing the window quits (on macOS, closes it)', async () => {
  const userDataDir = newUserDataDir()
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 1, settings: { general: { closeToTray: false } } })
  )
  const { app } = await launchApp(userDataDir)
  if (process.platform === 'darwin') {
    // macOS apps stay running in the dock with no window; the dock icon opens a new one.
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      await expect.poll(() => windowState(app)).toEqual([])
      await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'))
      await expect.poll(() => windowState(app)).toEqual([{ visible: true, destroyed: false }])
    } finally {
      await app.close()
    }
    return
  }
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await exited
})

test('mining pauses while the computer sleeps and reloads on wake', async () => {
  const twitch = await startMockTwitch()
  const { app, window: page } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const status = page.getByTestId('miner-status')
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(status).toHaveText('Idle: No campaigns to mine right now', { timeout: 15_000 })

    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
    await expect(status).toHaveText('Paused: The computer is asleep')

    const inventoryLoads = twitch.gqlCalls.filter((op) => op === 'Inventory').length
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
    await expect(status).toHaveText('Idle: No campaigns to mine right now', { timeout: 15_000 })
    // Waking re-checks the session and reloads everything rather than trusting stale state.
    expect(twitch.gqlCalls.filter((op) => op === 'Inventory').length).toBeGreaterThan(
      inventoryLoads
    )
  } finally {
    await app.close()
    await twitch.close()
  }
})
