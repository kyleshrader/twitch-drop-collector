// Campaigns Twitch stops listing stay in the Library: the app saves a full copy of each campaign
// as the inventory loads, and shows its last copy once Twitch no longer lists it.
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch, type MockTwitch } from './mock-twitch'

/** The Overwatch campaign in the mock's inventory. */
const OVERWATCH = { id: '5f277031-448e-4eb2-8817-45f56779633c', name: 'OWCS Stage 3 Playoffs' }

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

async function signIn(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sign in with Twitch' })
  // The saved session may restore by itself on the second launch.
  await Promise.race([
    button.waitFor({ timeout: 15_000 }).then(() => button.click()),
    page.getByTestId('next-ui').getByRole('link', { name: 'Library' }).waitFor({ timeout: 15_000 })
  ])
}

async function openOverwatch(page: Page): Promise<void> {
  const ui = page.getByTestId('next-ui')
  await ui.getByRole('link', { name: 'Library' }).click()
  await ui
    .getByRole('navigation', { name: 'Library' })
    .getByRole('link', { name: /^Overwatch/ })
    .click()
}

test('a campaign Twitch stops listing is still shown, from its saved copy', async () => {
  const userDataDir = newUserDataDir()
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 1, settings: { general: { ui: 'next' } } })
  )
  const env = { TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url)) }

  // First run: Twitch lists the campaign; the app saves its copy as the inventory loads.
  {
    const { app, window: page } = await launchApp(userDataDir, env)
    try {
      await signIn(page)
      await openOverwatch(page)
      const row = page.getByRole('row', { name: new RegExp(OVERWATCH.name) })
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row).not.toContainText('No longer listed')
    } finally {
      await app.close()
    }
  }

  // Second run: Twitch no longer lists it. The Library still shows it, marked, with its drops.
  twitch.hidden.add(OVERWATCH.id)
  const { app, window: page } = await launchApp(userDataDir, env)
  try {
    await signIn(page)
    await openOverwatch(page)
    const ui = page.getByTestId('next-ui')
    const row = ui.getByRole('row', { name: new RegExp(OVERWATCH.name) })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText('No longer listed')
    await expect(ui.getByText(/campaigns? seen, 0 listed by Twitch now/)).toBeVisible()
    await row.getByRole('button', { name: /^Show the drops in / }).click()
    await expect(
      ui
        .getByRole('list', { name: /^Drops in / })
        .getByRole('listitem')
        .first()
    ).toBeVisible()
    // Its copy is complete, so there's no "only its count is known" footnote.
    await expect(ui.getByText(/only (its|their) count is known/)).toHaveCount(0)
  } finally {
    await app.close()
  }
})
