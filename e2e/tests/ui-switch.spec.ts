// The window can show the classic UI or the new one (in preview), switched from either and kept
// across restarts. Everything else in the e2e suite runs on the classic UI.
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir } from './app'

const savedUi = async (userDataDir: string): Promise<string> =>
  (
    JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      settings: { general: { ui: string } }
    }
  ).settings.general.ui

test('switches to the new UI and back, and remembers the choice', async () => {
  const userDataDir = newUserDataDir()

  const first = await launchApp(userDataDir)
  try {
    const page = first.window
    await expect(page.getByRole('tab', { name: 'Main' })).toBeVisible()
    await expect(page.getByTestId('next-ui')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Try the new UI' }).click()
    await expect(page.getByTestId('next-ui')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Main' })).toHaveCount(0)
    // The new UI reads the same live state as the classic one.
    await expect(page.getByTestId('next-ui').getByRole('status')).toContainText('Not signed in')
    await expect.poll(() => savedUi(userDataDir)).toBe('next')
  } finally {
    await first.app.close()
  }

  const second = await launchApp(userDataDir)
  try {
    const page = second.window
    await expect(page.getByTestId('next-ui')).toBeVisible()
    await page.getByRole('button', { name: 'Back to the classic UI' }).click()
    await expect(page.getByRole('tab', { name: 'Main' })).toBeVisible()
    await expect(page.getByTestId('next-ui')).toHaveCount(0)
    await expect.poll(() => savedUi(userDataDir)).toBe('classic')

    // Saving the classic settings form keeps the choice it didn't make.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByLabel('Theme').selectOption('dark')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status')).toHaveText('Settings saved')
    expect(await savedUi(userDataDir)).toBe('classic')
  } finally {
    await second.app.close()
  }
})
