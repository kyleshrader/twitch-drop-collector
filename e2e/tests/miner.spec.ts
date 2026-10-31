// M7b: after sign-in the miner starts by itself, loads campaigns from (mock) Twitch, claims what's
// finished, and the window follows along through main → renderer events.
import { expect, test } from '@playwright/test'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch, type MockTwitch } from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

test('the miner loads campaigns, claims finished drops and shows it all live', async () => {
  const { app, window: page } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  try {
    await expect(page.getByTestId('miner-status')).toHaveText('Not mining (sign in to start)')
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(page.getByTestId('auth-status')).toHaveText('Signed in as e2euser')

    // Nothing is on the priority list, so the miner loads, claims, then idles.
    await expect(page.getByTestId('miner-status')).toHaveText(
      'Idle: No campaigns to mine right now',
      {
        timeout: 15_000
      }
    )
    expect(twitch.gqlCalls).toEqual(
      expect.arrayContaining(['Inventory', 'ViewerDropsDashboard', 'DropCampaignDetails'])
    )
    // The three finished Crimson Desert drops in the fixture inventory were claimed.
    expect(twitch.claims).toHaveLength(3)
    expect(twitch.claims.every((id) => id.startsWith('10000001#'))).toBe(true)

    await page.getByRole('tab', { name: 'Inventory' }).click()
    const crimson = page.getByRole('article', { name: /^Crimson Desert/ })
    await expect(crimson).toBeVisible()
    await expect(crimson.getByText('Claimed')).toHaveCount(3)
    await expect(page.getByRole('article', { name: /^Dark and Darker/ })).toContainText(
      'Account not linked'
    )
  } finally {
    await app.close()
  }
})
