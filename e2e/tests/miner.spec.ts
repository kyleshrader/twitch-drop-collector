// After sign-in the miner starts by itself, loads campaigns from (mock) Twitch and claims what's
// finished. With a game on Priority it watches that game's channels, follows progress and claims
// over PubSub, switches channels when a stream ends, and follows the user's channel pick.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, logOf, newUserDataDir, twitchEndpoints } from './app'
import {
  MINING_CHANNELS,
  MINING_DROPS,
  MINING_GAME,
  startMockTwitch,
  type MockTwitch
} from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

const IDLE = 'No campaigns to mine right now'

/** Sets a game's list from its page in the Library. */
async function setList(page: Page, game: string, list: 'Priority' | 'Not set'): Promise<void> {
  const ui = page.getByTestId('next-ui')
  await ui.getByRole('link', { name: 'Library' }).click()
  await ui
    .getByRole('navigation', { name: 'Library' })
    .getByRole('link', { name: new RegExp(`^${game}`) })
    .click()
  await ui
    .getByRole('group', { name: `List for ${game}` })
    .getByRole('button', { name: list })
    .click()
  await ui.getByRole('link', { name: 'Drops' }).click()
}

/** F5, sent as the OS would (Playwright's own key presses skip the window's input handler). */
const refresh = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F5' })
  )

test('the miner loads campaigns, claims finished drops and shows it all live', async () => {
  const {
    app,
    window: page,
    userDataDir
  } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const ui = page.getByTestId('next-ui')
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(ui.getByRole('button', { name: 'Account', exact: true })).toContainText('e2euser')

    // Nothing is on the priority list, so the miner loads, claims, then idles.
    await expect(ui.getByRole('region', { name: 'Current' })).toContainText(IDLE, {
      timeout: 15_000
    })
    expect(twitch.gqlCalls).toEqual(
      expect.arrayContaining(['Inventory', 'ViewerDropsDashboard', 'DropCampaignDetails'])
    )
    // The three finished Crimson Desert drops in the fixture inventory were claimed.
    expect(twitch.claims).toHaveLength(3)
    expect(twitch.claims.every((id) => id.startsWith('10000001#'))).toBe(true)
    // Each claim is announced (logged instead of shown in test runs).
    const log = logOf(userDataDir)
    await expect.poll(() => log().match(/Drop claimed: Crimson Desert/g)?.length ?? 0).toBe(3)
    await expect(ui.getByRole('region', { name: 'Completed' })).toContainText('Crimson Desert')

    // A game whose rewards need a linked account says so, with the link.
    await ui.getByRole('link', { name: 'Library' }).click()
    await ui
      .getByRole('navigation', { name: 'Library' })
      .getByRole('link', { name: /^Dark and Darker/ })
      .click()
    await expect(ui.getByRole('button', { name: 'Link account on Twitch' })).toBeVisible()

    // Refreshing fetches the inventory again. (The mock still reports those drops unclaimed, so
    // they're claimed again; that's why this comes last.)
    const inventoryCalls = (): number => twitch.gqlCalls.filter((c) => c === 'Inventory').length
    const before = inventoryCalls()
    await refresh(app)
    await expect.poll(inventoryCalls).toBeGreaterThan(before)
  } finally {
    await app.close()
  }
})

test('the miner watches a priority game, follows progress, claims and switches channels', async () => {
  const {
    app,
    window: page,
    userDataDir
  } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const [first, second, third] = MINING_CHANNELS
  const name = (c: (typeof MINING_CHANNELS)[number]): string => c.broadcaster.displayName
  const ui = page.getByTestId('next-ui')
  const current = ui.getByRole('region', { name: 'Current' })
  try {
    // With nothing on the priority list the miner loads campaigns, then idles.
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(current).toContainText(IDLE, { timeout: 15_000 })

    // On Priority, the most-watched live channel for the game is watched the way Twitch counts it.
    await setList(page, MINING_GAME.displayName, 'Priority')
    await expect(current).toContainText('Mining now', { timeout: 15_000 })
    await expect(current).toContainText(`Watching ${name(first!)}`)
    await expect.poll(() => twitch.watched).toContain(first!.broadcaster.login)

    // Progress arrives over PubSub.
    const userDrops = 'user-drop-events.4242'
    await expect.poll(() => twitch.topics.has(userDrops)).toBe(true)
    twitch.publish(userDrops, {
      type: 'drop-progress',
      data: { drop_id: MINING_DROPS[0].id, current_progress_min: 59, required_progress_min: 60 }
    })
    const firstDrop = current.getByRole('progressbar', { name: MINING_DROPS[0].name })
    await expect(firstDrop).toHaveAttribute('aria-valuenow', '59')

    // So does the claim; then the miner moves on to the next drop.
    twitch.publish(userDrops, {
      type: 'drop-claim',
      data: { drop_id: MINING_DROPS[0].id, drop_instance_id: 'e2e-claim-1' }
    })
    await expect.poll(() => twitch.claims).toContain('e2e-claim-1')
    await expect.poll(logOf(userDataDir)).toContain('Drop claimed: Black Desert')
    await expect(current.getByRole('progressbar', { name: MINING_DROPS[1].name })).toBeVisible({
      timeout: 15_000
    })

    // The stream ends: the miner switches to the next channel.
    const streamState = `video-playback-by-id.${first!.broadcaster.id}`
    await expect.poll(() => twitch.topics.has(streamState)).toBe(true)
    twitch.offline.add(first!.broadcaster.login)
    twitch.publish(streamState, { type: 'stream-down' })
    await expect(current).toContainText(`Watching ${name(second!)}`)
    await expect.poll(() => twitch.watched).toContain(second!.broadcaster.login)

    // The channel menu offers the channels streaming the game: not the one that went offline.
    await current.getByRole('button', { name: 'Change channel' }).click()
    const menu = page.getByRole('dialog', { name: 'Change channel' })
    await expect(menu.getByRole('button', { name: new RegExp(name(second!)) })).toBeVisible()
    await expect(menu.getByRole('button', { name: new RegExp(name(first!)) })).toHaveCount(0)
    // The user picks a channel; letting the miner choose again keeps a channel that's as good.
    await menu.getByRole('button', { name: new RegExp(name(third!)) }).click()
    await expect(current).toContainText(`Watching ${name(third!)}`)
    await current.getByRole('button', { name: 'Change channel' }).click()
    await page.getByRole('button', { name: 'Let the miner choose' }).click()
    await expect(current).toContainText(`Watching ${name(third!)}`)
    await current.getByRole('button', { name: 'Change channel' }).click()
    await expect(page.getByRole('button', { name: 'Let the miner choose' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Taking the game off Priority stops watching it.
    await setList(page, MINING_GAME.displayName, 'Not set')
    await expect.poll(() => twitch.topics.size).toBe(2)
    await expect(current).toContainText(IDLE)

    // Signing out stops the miner.
    await ui.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in with Twitch' })).toBeVisible()
    await expect.poll(() => twitch.topics.size).toBe(0)
  } finally {
    await app.close()
  }
})
