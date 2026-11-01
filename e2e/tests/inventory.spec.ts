// The inventory's shop-style filters on the fixture campaigns: nothing ticked shows everything,
// options in a category combine with "or", categories with "and", and the choice survives
// switching tabs.
import { expect, test, type Locator } from '@playwright/test'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch, type MockTwitch } from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

const labels = (articles: Locator): Promise<string[]> =>
  articles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))

test('the inventory filters by category, shop-style', async () => {
  const { app, window: page } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(page.getByTestId('miner-status')).toHaveText(/^Idle/, { timeout: 15_000 })
    await page.getByRole('tab', { name: 'Inventory' }).click()

    const campaigns = page.getByTestId('campaign')
    const filters = page.getByRole('search', { name: 'Filter campaigns' })
    const category = (name: string): Locator => filters.getByRole('group', { name })
    const option = (group: string, name: string): Locator =>
      category(group).getByRole('checkbox', { name: new RegExp(`^${name} \\(\\d+\\)$`) })
    const showing = page.getByRole('status').filter({ hasText: /^Showing/ })

    // Nothing ticked: every campaign shows, ended ones included.
    const total = await campaigns.count()
    expect(total).toBeGreaterThan(0)
    await expect(showing).toHaveText(`Showing ${total} of ${total}`)
    await expect(page.getByRole('button', { name: 'Clear all filters' })).toHaveCount(0)

    // One status: only ended campaigns. A second status adds to it.
    await option('Status', 'Ended').check()
    for (const text of await campaigns.allTextContents()) expect(text).toMatch(/^.*Ended ·/)
    const ended = await campaigns.count()
    await option('Status', 'Active').check()
    await expect.poll(() => campaigns.count()).toBeGreaterThan(ended)
    await category('Status').getByRole('button', { name: 'Clear Status' }).click()
    await expect(showing).toHaveText(`Showing ${total} of ${total}`)

    // A game, and within it only finished campaigns: Crimson Desert's drops are all claimed.
    const showAll = category('Game').getByRole('button', { name: /^Show all/ })
    if (await showAll.count()) await showAll.click()
    await option('Game', 'Crimson Desert').check()
    for (const name of await labels(campaigns)) expect(name).toMatch(/^Crimson Desert/)
    await option('Progress', 'Finished').check()
    await expect(page.getByRole('article', { name: /^Crimson Desert/ }).first()).toBeVisible()
    // No Crimson Desert campaign is untouched, so that option offers nothing and can't be ticked.
    await expect(option('Progress', 'Not started')).toHaveAccessibleName('Not started (0)')
    await expect(option('Progress', 'Not started')).toBeDisabled()

    // Clear all, then campaigns whose game account isn't linked: Dark and Darker is one.
    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(showing).toHaveText(`Showing ${total} of ${total}`)
    await option('Game account', 'Not linked').check()
    await expect(page.getByRole('article', { name: /^Dark and Darker/ })).toBeVisible()
    for (const text of await campaigns.allTextContents()) expect(text).toContain('not linked')

    // Search narrows within the ticked options too.
    await filters.getByRole('searchbox', { name: 'Search' }).fill('zzz-no-such-game')
    await expect(page.getByText('No campaigns match these filters.')).toBeVisible()
    await filters.getByRole('searchbox', { name: 'Search' }).fill('')

    // The choice survives switching tabs.
    await page.getByRole('tab', { name: 'Main' }).click()
    await page.getByRole('tab', { name: 'Inventory' }).click()
    await expect(option('Game account', 'Not linked')).toBeChecked()

    // Each card can put its game on the priority or excluded list, saved straight to settings.
    await page.getByRole('button', { name: 'Clear all filters' }).click()
    const blackDesert = page.getByRole('article', { name: /^Black Desert/ }).first()
    const darker = page.getByRole('article', { name: /^Dark and Darker/ }).first()
    await blackDesert.getByRole('button', { name: 'Add Black Desert to priority' }).click()
    await darker.getByRole('button', { name: 'Add Dark and Darker to excluded' }).click()
    // On a list, a card only offers to take its game off it.
    await expect(
      blackDesert.getByRole('button', { name: 'Remove Black Desert from priority' })
    ).toBeVisible()
    await expect(blackDesert.getByRole('button', { name: /^Add / })).toHaveCount(0)
    await expect(
      darker.getByRole('button', { name: 'Remove Dark and Darker from excluded' })
    ).toBeVisible()

    // Settings shows the same lists.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(
      page.getByRole('list', { name: 'Priority games (highest first)' }).getByRole('listitem')
    ).toHaveText([/^Black Desert/])
    await expect(
      page.getByRole('list', { name: 'Excluded games' }).getByRole('listitem')
    ).toHaveText([/^Dark and Darker/])
    await page.getByRole('tab', { name: 'Inventory' }).click()

    // "Your lists" follows them, and cards say where their game stands.
    await option('Your lists', 'Priority').check()
    for (const name of await labels(campaigns)) expect(name).toMatch(/^Black Desert/)
    await expect(campaigns.first()).toContainText('Priority #1')
    await option('Your lists', 'Priority').uncheck()
    await option('Your lists', 'Excluded').check()
    for (const name of await labels(campaigns)) expect(name).toMatch(/^Dark and Darker/)
    await expect(campaigns.first()).toContainText('Excluded')

    // Taking it off the list leaves nothing excluded and offers both lists again.
    await darker.getByRole('button', { name: 'Remove Dark and Darker from excluded' }).click()
    await expect(page.getByText('No campaigns match these filters.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(
      darker.getByRole('button', { name: 'Add Dark and Darker to priority' })
    ).toBeVisible()
    await expect(
      darker.getByRole('button', { name: 'Add Dark and Darker to excluded' })
    ).toBeVisible()
  } finally {
    await app.close()
  }
})
