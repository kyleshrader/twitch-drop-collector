// M4 acceptance: settings changed in the UI survive an app restart.
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir } from './app'

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible()
}

test('settings survive a restart', async () => {
  const userDataDir = newUserDataDir()

  const first = await launchApp(userDataDir)
  await openSettings(first.window)
  await first.window.getByLabel('Start in the tray when started at login').check()
  await first.window.getByLabel('Show a notification when a drop is claimed').uncheck()
  await first.window.getByLabel('Theme').selectOption('dark')
  // Signed out there are no campaigns to suggest, so games are added by typing their names.
  const priority = first.window.getByRole('combobox', { name: 'Priority games (highest first)' })
  for (const game of ['Rust', 'Marvel Rivals']) {
    await priority.fill(game)
    await priority.press('Enter')
  }
  await first.window.getByRole('button', { name: 'Move Marvel Rivals up' }).click()
  const exclude = first.window.getByRole('combobox', { name: 'Excluded games' })
  await exclude.fill('Fortnite')
  await first.window.getByRole('option', { name: 'Add “Fortnite”' }).click()
  // A game can't be on both lists: the other list doesn't offer it, and Enter doesn't add it.
  await exclude.fill('rust')
  await expect(exclude).toHaveAttribute('aria-expanded', 'false')
  await exclude.press('Enter')
  await priority.fill('fortnite')
  await expect(priority).toHaveAttribute('aria-expanded', 'false')
  await priority.press('Enter')
  await exclude.fill('')
  await priority.fill('')
  await first.window.getByLabel('Priority mode').selectOption('endingSoonest')
  await first.window.getByLabel('Connection quality (1 = fast, 6 = slow)').fill('4')
  await first.window.getByLabel('When a new version is out').selectOption('auto')
  await first.window.getByLabel('Include pre-release versions').check()
  // Dev builds can't update themselves, and say so.
  await expect(first.window.getByTestId('update-status')).toContainText(
    'Updates aren’t available in this build.'
  )
  await first.window.getByRole('button', { name: 'Save settings' }).click()
  await expect(first.window.getByRole('status')).toHaveText('Settings saved')
  // The theme setting is applied in main right away.
  expect(await first.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await first.app.close()

  const file = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
    version: number
    settings: { mining: { priority: string[]; exclude: string[] } }
  }
  expect(file.version).toBe(1)
  expect(file.settings.mining.priority).toEqual(['Marvel Rivals', 'Rust'])
  expect(file.settings.mining.exclude).toEqual(['Fortnite'])

  const second = await launchApp(userDataDir)
  try {
    await openSettings(second.window)
    await expect(second.window.getByLabel('Start in the tray when started at login')).toBeChecked()
    await expect(
      second.window.getByLabel('Show a notification when a drop is claimed')
    ).not.toBeChecked()
    await expect(second.window.getByLabel('Theme')).toHaveValue('dark')
    await expect(
      second.window
        .getByRole('list', { name: 'Priority games (highest first)' })
        .getByRole('listitem')
    ).toHaveText([/^Marvel Rivals/, /^Rust/])
    await expect(
      second.window.getByRole('list', { name: 'Excluded games' }).getByRole('listitem')
    ).toHaveText([/^Fortnite/])
    await expect(second.window.getByLabel('Priority mode')).toHaveValue('endingSoonest')
    await expect(second.window.getByLabel('Connection quality (1 = fast, 6 = slow)')).toHaveValue(
      '4'
    )
    await expect(second.window.getByLabel('When a new version is out')).toHaveValue('auto')
    await expect(second.window.getByLabel('Include pre-release versions')).toBeChecked()
    expect(await second.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  } finally {
    await second.app.close()
  }
})

test('invalid settings are rejected by main and shown to the user', async () => {
  const { app, window: page } = await launchApp()
  try {
    await openSettings(page)
    await page.getByLabel('Proxy URL (leave empty for none)').fill('not a proxy')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status')).toHaveText('Could not save settings')
    await expect(page.getByRole('alert')).toContainText('network.proxy')
  } finally {
    await app.close()
  }
})
