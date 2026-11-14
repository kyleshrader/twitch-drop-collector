// The History page: claims (here, Twitch's own award times from the inventory), what was
// watched, and how campaigns ended, with totals that filter, a search, and a game filter.
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
import { MINING_GAME, startMockTwitch, type MockTwitch } from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

test('History lists claims, watching and ended campaigns, and filters them', async () => {
  const userDataDir = newUserDataDir()
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: 1,
      settings: { mining: { priority: [MINING_GAME.displayName] } }
    })
  )
  const { app, window: page } = await launchApp(userDataDir, {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url)),
    // Watching is counted every half second instead of every minute.
    TDC_E2E_WATCH_TICK_MS: '500'
  })
  const ui = page.getByTestId('next-ui')
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(ui.getByRole('region', { name: 'Current' })).toContainText(
      MINING_GAME.displayName,
      { timeout: 20_000 }
    )

    // Pausing and resuming, and a list change, are recorded as they happen.
    const current = ui.getByRole('region', { name: 'Current' })
    await current.getByRole('button', { name: 'Pause' }).click()
    await current.getByRole('button', { name: 'Resume' }).click()
    await current.getByRole('button', { name: 'Pause' }).waitFor()
    const settingsFile = join(userDataDir, 'settings.json')
    // As the Library's list control does: through settings:update.
    await page.evaluate(
      (game) =>
        (
          window as unknown as {
            api: { invoke: (c: string, i: unknown) => Promise<unknown> }
          }
        ).api.invoke('settings:update', { mining: { exclude: [game] } }),
      'Rocket League'
    )
    await expect
      .poll(async () => (await readFile(settingsFile, 'utf8')).includes('Rocket League'))
      .toBe(true)

    // From the top bar (also Alt+3). It reads the history each time it opens.
    const historyLink = ui.getByRole('link', { name: 'History' })
    await expect(historyLink).toHaveAttribute('aria-keyshortcuts', 'Alt+3')
    const entries = ui.getByTestId('history-entry')
    await expect
      .poll(
        async () => {
          await ui.getByRole('link', { name: 'Drops' }).click()
          await historyLink.click()
          await expect(entries.first()).toBeVisible()
          return entries.filter({ hasText: /^Watched for/ }).count()
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0)
    await expect(ui.getByRole('heading', { name: 'History', level: 2 })).toBeVisible()
    const watched = entries.filter({ hasText: /^Watched for/ }).first()
    await expect(watched).toContainText(MINING_GAME.displayName)

    // Claims from Twitch's inventory say whose time it is.
    const claims = entries.and(page.locator('[data-kind="claim"]'))
    await expect(claims.first()).toBeVisible()
    await expect(claims.filter({ hasText: 'Time from Twitch' }).first()).toBeVisible()

    // A total filters the list to its kind, and again shows everything.
    const dropsStat = ui.getByRole('button', { name: /^Drops claimed/ })
    await dropsStat.click()
    await expect(dropsStat).toHaveAttribute('aria-pressed', 'true')
    await expect(
      ui.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Claims' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(await entries.count()).toBe(await claims.count())
    await dropsStat.click()
    await expect(watched).toBeVisible()

    // The search finds by reward, game, campaign or channel.
    // The first line is the reward; the second, its game and campaign.
    const [firstReward = ''] = (await claims.first().innerText()).split('\n')
    const search = ui.getByRole('searchbox', { name: 'Search games, rewards and channels' })
    await search.fill(firstReward)
    await expect(entries.first()).toContainText(firstReward)
    await search.fill('no such thing anywhere')
    await expect(ui.getByText('Nothing matches these filters.')).toBeVisible()
    await ui.getByRole('button', { name: 'Clear filters' }).click()
    await expect(search).toHaveValue('')

    // A game in the side list narrows the list to it; its chip undoes that.
    await ui
      .getByRole('complementary', { name: 'Games' })
      .getByRole('button', { name: MINING_GAME.displayName })
      .click()
    await expect(ui.getByRole('button', { name: 'All games', exact: true })).toBeVisible()
    for (const text of await entries.allInnerTexts()) {
      expect(text).toContain(MINING_GAME.displayName)
    }
    await ui.getByRole('button', { name: 'All games', exact: true }).click()
    await expect(claims.first()).toBeVisible()

    // Library & app: the list change, and the pause and resume, newest first.
    await ui
      .getByRole('group', { name: 'Show' })
      .getByRole('button', { name: 'Library & app' })
      .click()
    await expect(entries.first()).toContainText('Rocket League excluded')
    await expect(entries.filter({ hasText: 'Paused all activity' })).toHaveCount(1)
    await expect(entries.filter({ hasText: 'Resumed mining' })).toHaveCount(1)
    await ui
      .getByRole('group', { name: 'Show' })
      .getByRole('button', { name: 'Everything' })
      .click()

    // The range is remembered on this device.
    await ui
      .getByRole('group', { name: 'Time range' })
      .getByRole('button', { name: 'All time' })
      .click()
    await ui.getByRole('link', { name: 'Drops' }).click()
    await historyLink.click()
    await expect(
      ui.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'All time' })
    ).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await app.close()
  }
})
