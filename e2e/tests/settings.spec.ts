// Settings changed in the app are saved at once and survive a restart; a bad proxy address isn't
// saved; Priority games can be reordered from their page in the Library.
import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch } from './mock-twitch'

interface SavedSettings {
  general: { startMinimized: boolean; trayNotifications: boolean; theme: string }
  mining: { priority: string[]; availableDropsCheck: boolean }
  network: { proxy: string; connectionQuality: number }
  logging: { level: string }
  updates: { mode: string; prereleases: boolean }
}
const saved = async (userDataDir: string): Promise<SavedSettings> =>
  (
    JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      settings: SavedSettings
    }
  ).settings

/** Settings is reachable signed out too (from the account menu once signed in). */
async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings'))
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible()
}

test('settings are saved as they change and survive a restart', async () => {
  const userDataDir = newUserDataDir()
  const first = await launchApp(userDataDir)
  const page = first.window
  await openSettings(page)
  await page.getByRole('switch', { name: 'Start in the tray' }).click()
  await page.getByRole('switch', { name: 'Notifications' }).click()
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
  await page.getByRole('switch', { name: 'Confirm drops on each channel' }).click()
  await page.getByRole('switch', { name: 'Install updates automatically' }).click()
  await page.getByRole('switch', { name: 'Get beta versions' }).click()
  await page.getByLabel('Connection quality').selectOption('4')
  await page.getByLabel('Log detail').selectOption('debug')
  const proxy = page.getByLabel('Proxy')
  await proxy.fill('socks5://127.0.0.1:1080')
  await proxy.press('Enter')
  await expect
    .poll(async () => (await saved(userDataDir)).network.proxy)
    .toBe('socks5://127.0.0.1:1080')
  // The theme is applied in main right away.
  expect(await first.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await first.app.close()

  expect(await saved(userDataDir)).toMatchObject({
    general: { startMinimized: true, trayNotifications: false, theme: 'dark' },
    mining: { availableDropsCheck: true },
    network: { proxy: 'socks5://127.0.0.1:1080', connectionQuality: 4 },
    logging: { level: 'debug' },
    // Automatic updates are the default, so the switch turned them off.
    updates: { mode: 'notify', prereleases: true }
  })

  const second = await launchApp(userDataDir)
  try {
    await openSettings(second.window)
    const on = (name: string) => second.window.getByRole('switch', { name })
    await expect(on('Start in the tray')).toHaveAttribute('aria-checked', 'true')
    await expect(on('Notifications')).toHaveAttribute('aria-checked', 'false')
    await expect(on('Confirm drops on each channel')).toHaveAttribute('aria-checked', 'true')
    await expect(on('Install updates automatically')).toHaveAttribute('aria-checked', 'false')
    await expect(on('Get beta versions')).toHaveAttribute('aria-checked', 'true')
    await expect(second.window.getByLabel('Connection quality')).toHaveValue('4')
    await expect(second.window.getByLabel('Proxy')).toHaveValue('socks5://127.0.0.1:1080')
    expect(await second.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  } finally {
    await second.app.close()
  }
})

test('a proxy address that isn’t valid is pointed out and not saved', async () => {
  const userDataDir = newUserDataDir()
  const { app, window: page } = await launchApp(userDataDir)
  try {
    await openSettings(page)
    const proxy = page.getByLabel('Proxy')
    await proxy.fill('not a proxy')
    await proxy.press('Enter')
    await expect(proxy).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText(/Use an http:\/\/, https:\/\/, socks/)).toBeVisible()
    await proxy.blur()
    // Nothing was written: the file doesn't exist yet, or has no proxy.
    const proxySaved = await saved(userDataDir)
      .then((s) => s.network.proxy)
      .catch(() => '')
    expect(proxySaved).toBe('')
  } finally {
    await app.close()
  }
})

test('a Priority game can be moved up and down the list from its page', async () => {
  const twitch = await startMockTwitch()
  const userDataDir = newUserDataDir()
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 1, settings: { mining: { priority: ['Rust', 'Marvel Rivals'] } } })
  )
  const { app, window: page } = await launchApp(userDataDir, {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const ui = page.getByTestId('next-ui')
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await ui.getByRole('link', { name: 'Library' }).click()
    await ui
      .getByRole('navigation', { name: 'Library' })
      .getByRole('link', { name: /^Marvel Rivals/ })
      .click()
    await expect(ui.getByText('#2 of 2')).toBeVisible()
    await expect(ui.getByRole('button', { name: 'Lower priority' })).toBeDisabled()
    await ui.getByRole('button', { name: 'Higher priority' }).click()
    await expect(ui.getByText('#1 of 2')).toBeVisible()
    await expect
      .poll(async () => (await saved(userDataDir)).mining.priority)
      .toEqual(['Marvel Rivals', 'Rust'])
  } finally {
    await app.close()
    await twitch.close()
  }
})
