// M7b: after sign-in the miner starts by itself, loads campaigns from (mock) Twitch, claims what's
// finished, and the window follows along through main → renderer events. M12: it watches a
// priority game's channels, follows progress and claims over PubSub, and switches channels.
import { expect, test } from '@playwright/test'
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

test('the miner loads campaigns, claims finished drops and shows it all live', async () => {
  const {
    app,
    window: page,
    userDataDir
  } = await launchApp(newUserDataDir(), {
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
    // Each claim is announced (logged instead of shown in test runs).
    const log = logOf(userDataDir)
    await expect.poll(() => log().match(/Drop claimed: Crimson Desert/g)?.length ?? 0).toBe(3)

    await page.getByRole('tab', { name: 'Inventory' }).click()
    const crimson = page.getByRole('article', { name: /^Crimson Desert/ })
    await expect(crimson).toBeVisible()
    await expect(crimson.getByText('Claimed')).toHaveCount(3)
    await expect(page.getByRole('article', { name: /^Dark and Darker/ })).toContainText(
      'Account not linked'
    )

    // Reload fetches the inventory again. (The mock still reports those drops unclaimed, so
    // they're claimed again; that's why this comes last.)
    await page.getByRole('tab', { name: 'Main' }).click()
    const inventoryCalls = (): number => twitch.gqlCalls.filter((c) => c === 'Inventory').length
    const before = inventoryCalls()
    await page.getByRole('button', { name: 'Reload campaigns' }).click()
    await expect.poll(inventoryCalls).toBeGreaterThan(before)
  } finally {
    await app.close()
  }
})

test('the miner watches a priority game, follows progress, claims and switches channels', async () => {
  // A long flow, with a 4 s wait after the claim; slower CI runners need more than 30 s.
  test.setTimeout(60_000)
  const {
    app,
    window: page,
    userDataDir
  } = await launchApp(newUserDataDir(), {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const [first, second, third] = MINING_CHANNELS
  const watching = page.getByTestId('miner-watching')
  const active = page.getByTestId('miner-active')
  const name = (c: (typeof MINING_CHANNELS)[number]): string => c.broadcaster.displayName
  try {
    // With nothing on the priority list the miner loads campaigns, then idles.
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()
    await expect(page.getByTestId('miner-status')).toHaveText(
      'Idle: No campaigns to mine right now',
      { timeout: 15_000 }
    )

    // The priority list suggests games that have campaigns; typing narrows them down.
    await page.getByRole('tab', { name: 'Settings' }).click()
    const priority = page.getByRole('combobox', { name: 'Priority games (highest first)' })
    await priority.click()
    await expect(page.getByRole('option', { name: 'Dark and Darker' })).toBeVisible()
    await priority.fill('black')
    const suggestions = page.getByRole('listbox', {
      name: 'Priority games (highest first): suggestions'
    })
    await expect(suggestions.getByRole('option')).toHaveText([
      MINING_GAME.displayName,
      'Add “black”'
    ])
    await page.getByRole('option', { name: MINING_GAME.displayName }).click()
    await expect(
      page.getByRole('list', { name: 'Priority games (highest first)' }).getByRole('listitem')
    ).toHaveText([new RegExp(`^${MINING_GAME.displayName}`)])
    // A priority game isn't offered for the excluded list.
    await page.getByRole('combobox', { name: 'Excluded games' }).click()
    const excludeSuggestions = page
      .getByRole('listbox', { name: 'Excluded games: suggestions' })
      .getByRole('option')
    await expect(excludeSuggestions.filter({ hasText: 'Dark and Darker' })).toBeVisible()
    expect(await excludeSuggestions.allTextContents()).not.toContain(MINING_GAME.displayName)
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status')).toHaveText('Settings saved')
    await page.getByRole('tab', { name: 'Main' }).click()

    // The most-watched live channel for the game, watched the way Twitch counts it.
    await expect(page.getByTestId('miner-status')).toHaveText('Mining', { timeout: 15_000 })
    await expect(watching).toContainText(`Watching ${name(first!)} playing Black Desert`)
    await expect.poll(() => twitch.watched).toContain(first!.broadcaster.login)

    // Progress arrives over PubSub.
    const userDrops = 'user-drop-events.4242'
    await expect.poll(() => twitch.topics.has(userDrops)).toBe(true)
    twitch.publish(userDrops, {
      type: 'drop-progress',
      data: { drop_id: MINING_DROPS[0].id, current_progress_min: 59, required_progress_min: 60 }
    })
    await expect(active).toContainText(MINING_DROPS[0].name)
    await expect(active).toContainText('59 / 60 min')

    // So does the claim; then the miner moves on to the next drop.
    twitch.publish(userDrops, {
      type: 'drop-claim',
      data: { drop_id: MINING_DROPS[0].id, drop_instance_id: 'e2e-claim-1' }
    })
    await expect.poll(() => twitch.claims).toContain('e2e-claim-1')
    await expect.poll(logOf(userDataDir)).toContain('Drop claimed: Black Desert')
    await expect(active).toContainText(MINING_DROPS[1].name, { timeout: 15_000 })

    // The stream ends: the miner switches to the next channel.
    const streamState = `video-playback-by-id.${first!.broadcaster.id}`
    await expect.poll(() => twitch.topics.has(streamState)).toBe(true)
    twitch.offline.add(first!.broadcaster.login)
    twitch.publish(streamState, { type: 'stream-down' })
    await expect(watching).toContainText(`Watching ${name(second!)}`)
    await expect.poll(() => twitch.watched).toContain(second!.broadcaster.login)

    // Only channels the miner would follow offer "Watch this"; the others say why not.
    const row = (c: (typeof MINING_CHANNELS)[number]) =>
      page.getByRole('row', { name: new RegExp(name(c)) })
    await expect(row(first!).getByRole('button', { name: 'Watch this' })).toHaveCount(0)
    await expect(row(first!).getByRole('cell').last()).toHaveText('Offline')
    await expect(row(second!).getByRole('cell').last()).toHaveText('Watching')

    // The user picks a channel; letting the miner choose again keeps a channel that's as good.
    await row(third!).getByRole('button', { name: 'Watch this' }).click()
    await expect(watching).toContainText(`Watching ${name(third!)}`)
    await expect(row(third!)).toContainText('(your pick)')
    await page.getByRole('button', { name: 'Let the miner choose the channel' }).click()
    await expect(row(third!)).not.toContainText('(your pick)')
    await expect(watching).toContainText(`Watching ${name(third!)}`)

    // Taking the game off the priority list stops watching it.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: `Remove ${MINING_GAME.displayName}` }).click()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status')).toHaveText('Settings saved')
    // Stay on Settings until the miner has dropped the channels and its new state has gone out
    // to the window (events are sent at most every 250 ms): the Main tab must still show it.
    await expect.poll(() => twitch.topics.size).toBe(2)
    await page.waitForTimeout(500)
    await page.getByRole('tab', { name: 'Main' }).click()
    await expect(page.getByTestId('miner-status')).toHaveText(
      'Idle: No campaigns to mine right now'
    )
    await expect(watching).toHaveCount(0)

    // Signing out stops the miner.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByTestId('miner-status')).toHaveText('Not mining (sign in to start)')
    await expect.poll(() => twitch.topics.size).toBe(0)
  } finally {
    await app.close()
  }
})
