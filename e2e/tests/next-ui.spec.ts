// The new UI (docs/new-ui/): signing in, the Drops page mining a priority game, Pause and
// Resume, reordering Up next, the Library and the queue rules, against the mock Twitch.
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, newUserDataDir, twitchEndpoints } from './app'
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

interface SavedQueue {
  layout: string
  sort: string
  paused: boolean
  linkedFirst: boolean
  newInCustom: string
  order: string[]
}
const savedQueue = async (userDataDir: string): Promise<SavedQueue> =>
  (
    JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      settings: { queue: SavedQueue }
    }
  ).settings.queue

test('the new UI mines, pauses, reorders Up next and shows the library', async () => {
  const userDataDir = newUserDataDir()
  // Start in the new UI, with the mock's minable game on the priority list. Missing settings
  // take their defaults.
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: 1,
      settings: { mining: { priority: [MINING_GAME.displayName] } }
    })
  )
  const { app, window: page } = await launchApp(userDataDir, {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  // The window can't be made smaller than 920 × 400, frame and title bar included.
  const size = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(500, 300)
    return window.getSize()
  })
  expect(size).toEqual([920, 400])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 720))
  const ui = page.getByTestId('next-ui')
  const current = ui.getByRole('region', { name: 'Current' })
  const upNext = ui.getByRole('region', { name: 'Up next' })
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()

    // Current: the priority game, watched on its most-watched channel.
    await expect(current.getByRole('heading', { name: MINING_GAME.displayName })).toBeVisible({
      timeout: 15_000
    })
    await expect(current).toContainText(`Watching ${MINING_CHANNELS[0]!.broadcaster.displayName}`)
    // The channel's name opens it on Twitch.
    await expect(
      current.getByRole('link', { name: MINING_CHANNELS[0]!.broadcaster.displayName })
    ).toHaveAttribute('href', `https://www.twitch.tv/${MINING_CHANNELS[0]!.broadcaster.login}`)

    // A notification opens #/drops/<campaign or drop>: the page scrolls to it, focuses it and
    // highlights it, then the address goes back to plain Drops so the same one works again.
    const queued = upNext.getByTestId('queue-campaign').last()
    const target = (await queued.getAttribute('data-target'))!
    await page.evaluate((id) => (location.hash = `#/drops/${encodeURIComponent(id)}`), target)
    await expect(queued).toBeFocused()
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/drops')
    await expect(current.getByRole('progressbar')).toBeVisible()

    // Text can't be selected except what's worth copying: the drop's name can, the game's name,
    // the time left and buttons can't.
    const userSelect = (locator: typeof current): Promise<string> =>
      locator.evaluate((element) => getComputedStyle(element).userSelect)
    expect(await userSelect(current.getByRole('heading', { name: MINING_GAME.displayName }))).toBe(
      'none'
    )
    expect(await userSelect(current.getByText(MINING_DROPS[0].name).first())).toBe('text')
    expect(await userSelect(current.getByText('remaining'))).toBe('none')
    expect(await userSelect(current.getByRole('button', { name: 'Pause' }))).toBe('none')

    // The channel menu opens over the drops below the banner (a trial click fails if anything
    // covers it), and closes on Escape.
    await current.getByRole('button', { name: 'Change channel' }).click()
    const channelMenu = page.getByRole('dialog', { name: 'Change channel' })
    await channelMenu.getByRole('button').first().click({ trial: true })
    await page.keyboard.press('Escape')
    await expect(channelMenu).toHaveCount(0)

    // Middle-click autoscroll: hold the middle button and drag down; the page scrolls, and
    // stops when the button is let go.
    const main = ui.getByRole('main')
    const scrollTop = (): Promise<number> => main.evaluate((m) => m.scrollTop)
    const area = (await main.boundingBox())!
    const start = { x: area.x + 10, y: area.y + area.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(start.x, start.y + 150, { steps: 5 })
    await expect.poll(scrollTop).toBeGreaterThan(0)
    await page.mouse.up({ button: 'middle' })
    const stopped = await scrollTop()
    await page.waitForTimeout(300)
    expect(await scrollTop()).toBe(stopped)
    await main.evaluate((m) => (m.scrollTop = 0))
    // A middle click without dragging keeps scrolling towards the mouse until the next click.
    await page.mouse.click(start.x, start.y, { button: 'middle' })
    await page.mouse.move(start.x, start.y + 150, { steps: 5 })
    await expect.poll(scrollTop).toBeGreaterThan(0)
    await page.mouse.click(start.x, start.y + 150)
    const clicked = await scrollTop()
    await page.waitForTimeout(300)
    expect(await scrollTop()).toBe(clicked)
    await main.evaluate((m) => (m.scrollTop = 0))

    // Pause stops mining (and says so in the page links); Resume picks it up again.
    await current.getByRole('button', { name: 'Pause' }).click()
    await expect(current).toContainText('Mining is paused')
    await expect(ui.getByRole('img', { name: 'Mining is paused' })).toBeVisible()
    await expect.poll(async () => (await savedQueue(userDataDir)).paused).toBe(true)
    await current.getByRole('button', { name: 'Resume' }).click()
    await expect(current.getByRole('heading', { name: MINING_GAME.displayName })).toBeVisible({
      timeout: 15_000
    })

    // Up next holds the other campaigns. Only Priority games are mined, and it says so.
    await expect(upNext.getByTestId('queue-card').first()).toBeVisible()
    await expect(upNext).toContainText('Only Priority games are mined')

    // Sections collapse to their heading and open again.
    const upNextToggle = upNext.getByRole('button', { name: 'Up next', exact: true })
    await upNextToggle.click()
    await expect(upNextToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(upNext.getByTestId('queue-card').first()).toBeHidden()
    await upNextToggle.click()
    await expect(upNext.getByTestId('queue-card').first()).toBeVisible()

    // A campaign expands to show its drops, and collapses again.
    const expand = upNext.getByRole('button', { name: /^Show the drops in / }).first()
    await expand.click()
    const upNextDrops = upNext.getByRole('list', { name: /^Drops in / })
    await expect(upNextDrops.getByRole('listitem').first()).toBeVisible()
    await upNext
      .getByRole('button', { name: /^Hide the drops in / })
      .first()
      .click()
    await expect(upNextDrops).toHaveCount(0)

    // Every card says which channels count (a game's shared list, or each campaign's own).
    await expect(upNext.getByTestId('queue-channels').first()).toContainText(/Any channel|Only on/)

    // Group by game or by campaign: the same queue, regrouped.
    const groupBy = upNext.getByRole('group', { name: 'Group Up next by' })
    await expect(groupBy.getByRole('button')).toHaveText(['Game', 'Campaign'])
    await groupBy.getByRole('button', { name: 'Campaign' }).click()
    await expect(groupBy.getByRole('button', { name: 'Campaign' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect.poll(async () => (await savedQueue(userDataDir)).layout).toBe('campaigns')
    const cards = upNext.getByTestId('queue-card')
    const before = await cards.allInnerTexts()
    expect(before.length).toBeGreaterThan(1)

    // Moving a card switches the sort to Custom, which can be reset.
    const firstGame = (await cards.first().getAttribute('aria-label'))!
    await upNext
      .getByRole('button', { name: `Actions for ${firstGame}` })
      .first()
      .click()
    await page.getByRole('button', { name: 'Move down' }).click()
    await expect(upNext.getByRole('button', { name: 'Sort Up next' })).toContainText('Custom')
    await expect.poll(async () => (await savedQueue(userDataDir)).sort).toBe('custom')
    expect((await savedQueue(userDataDir)).order.length).toBeGreaterThan(1)
    await upNext.getByRole('button', { name: /^Reset to / }).click()
    await expect(upNext.getByRole('button', { name: 'Sort Up next' })).toHaveText('Sort: Priority')

    // The sort menu: each sort says what it does; Custom can't be picked, only started; and
    // the sorts' two preferences are saved from it.
    await upNext.getByRole('button', { name: 'Sort Up next' }).click()
    const queueSort = page.getByRole('dialog', { name: 'Sort Up next' })
    await expect(queueSort.getByRole('radio', { name: /^Priority/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(queueSort.getByRole('radio', { name: /^Custom/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await queueSort.getByRole('checkbox', { name: /^Linked games first/ }).click()
    await expect.poll(async () => (await savedQueue(userDataDir)).linkedFirst).toBe(false)
    await queueSort.getByRole('button', { name: 'At the bottom' }).click()
    await expect.poll(async () => (await savedQueue(userDataDir)).newInCustom).toBe('end')
    await queueSort.getByRole('radio', { name: /^Ending soonest/ }).click()
    await expect(queueSort).toHaveCount(0)
    await expect(upNext.getByRole('button', { name: 'Sort Up next' })).toHaveText(
      'Sort: Ending soonest'
    )
    await expect.poll(async () => (await savedQueue(userDataDir)).sort).toBe('ending')

    // At the smallest window size, a menu opened near the bottom stays inside the window.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(920, 400))
    const sortButton = upNext.getByRole('button', { name: 'Sort Up next' })
    await sortButton.evaluate((b) => b.scrollIntoView({ block: 'end' }))
    await sortButton.click()
    const upNextSort = page.getByRole('dialog', { name: 'Sort Up next' })
    const menuBox = (await upNextSort.boundingBox())!
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(menuBox.y).toBeGreaterThanOrEqual(0)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 720))

    // The Library lists the games, each with how many campaigns have been seen.
    await ui.getByRole('link', { name: 'Library' }).click()
    const games = ui.getByRole('navigation', { name: 'Library' })
    await expect(games.getByRole('link', { name: /^Black Desert/ })).toContainText('1')
    // Quick filters: the mined game has claimed nothing yet, so "claimed in the last 7 days"
    // leaves it out; games with claims dated by Twitch stay.
    const recent = ui.getByRole('button', { name: 'Only games claimed in the last 7 days' })
    await recent.click()
    await expect(recent).toHaveAttribute('aria-pressed', 'true')
    await expect(games.getByRole('link', { name: /^Black Desert/ })).toHaveCount(0)
    await expect(games.getByRole('link').first()).toBeVisible()
    await recent.click()
    await expect(games.getByRole('link', { name: /^Black Desert/ })).toBeVisible()
    // Sorted by recently claimed, under date headings; never-claimed games come last.
    await ui.getByRole('button', { name: 'Sort and group games' }).click()
    // The menu opens rightwards from the sidebar's edge, inside the window.
    const sortMenu = page.getByRole('dialog', { name: 'Sort and group games' })
    const box = await sortMenu.boundingBox()
    expect(box?.x).toBeGreaterThanOrEqual(0)
    await page.getByRole('button', { name: 'Recently claimed' }).click()
    await expect(ui.getByRole('region', { name: 'Nothing claimed yet' })).toContainText(
      MINING_GAME.displayName
    )
    await ui.getByRole('link', { name: MINING_GAME.displayName }).first().click()
    await expect(ui.getByRole('heading', { name: MINING_GAME.displayName })).toBeVisible()
    await expect(ui.getByRole('table')).toContainText('Active')
    await ui
      .getByRole('button', { name: /^Show the drops in / })
      .first()
      .click()
    const gameDrops = ui.getByRole('list', { name: /^Drops in / })
    // The mined campaign has three drops (MINING_DROPS names the two the miner test uses).
    await expect(gameDrops.getByRole('listitem')).toHaveCount(3)
    await expect(gameDrops).toContainText(MINING_DROPS[0].name)
    await expect(gameDrops.getByRole('progressbar').first()).toBeVisible()
    await expect(
      ui.getByRole('group', { name: `List for ${MINING_GAME.displayName}` })
    ).toBeVisible()

    // Back returns to the Library home, as the browser would.
    await page.goBack()
    await expect(ui.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    // Searching finds Twitch games without drops too; one can be put on a list from its page.
    await ui.getByRole('button', { name: 'Sort and group games' }).click()
    await page.getByRole('button', { name: 'Priority / Not set / Excluded' }).click()
    await ui.getByRole('searchbox', { name: 'Search games' }).fill('pebble')
    const onTwitch = games.getByRole('group', { name: 'On Twitch' })
    await expect(onTwitch.getByRole('link')).toHaveText([/Pebble Dash$/, /Pebble Quest$/])
    await onTwitch.getByRole('link', { name: 'Pebble Dash' }).click()
    await expect(ui.getByRole('heading', { name: 'Pebble Dash' })).toBeVisible()
    await expect(ui.getByText('No campaigns right now.')).toBeVisible()
    // Its Twitch page: shown, not clicked (it would open the real browser).
    await expect(ui.getByRole('button', { name: 'View on Twitch' })).toBeVisible()
    const pebbleList = ui.getByRole('group', { name: 'List for Pebble Dash' })
    await pebbleList.getByRole('button', { name: 'Priority' }).click()
    await expect(pebbleList.getByRole('button', { name: 'Priority' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // Now it's in the Library, under Priority, and the search no longer offers it.
    await expect(onTwitch.getByRole('link')).toHaveText([/Pebble Quest$/])
    // Main looks the listed game up and saves its address (and box art) for good.
    const savedSlug = (): Promise<unknown> =>
      page.evaluate(async () => {
        const api = (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api
        const result = (await api.invoke('miner:getState')) as {
          value?: { games?: Record<string, { slug?: string }> }
        }
        return result.value?.games?.['Pebble Dash']?.slug
      })
    await expect.poll(savedSlug).toBe('pebble-dash')
    await ui.getByRole('searchbox', { name: 'Search games' }).fill('')
    await expect(onTwitch).toHaveCount(0)
    const pebble = games.getByRole('link', { name: 'Pebble Dash' })
    await expect(pebble).toBeVisible()

    // A heading's −/+ collapses and expands it; its name shows just its games.
    await games.getByRole('button', { name: 'Collapse Priority' }).click()
    await expect(pebble).toBeHidden()
    await games.getByRole('button', { name: 'Expand Priority' }).click()
    await expect(pebble).toBeVisible()
    await games.getByRole('link', { name: /^Priority/ }).click()
    await expect(ui.getByRole('region', { name: 'Priority' })).toContainText('Pebble Dash')
    await expect(ui.getByRole('region', { name: 'Not set' })).toHaveCount(0)
    await expect(games.getByRole('link', { name: /^Priority/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await ui.getByRole('link', { name: 'Home' }).click()
    await expect(ui.getByRole('region', { name: 'Not set' })).toBeVisible()

    // The keyboard. Alt+2 and Alt+1 go to Drops and the Library.
    const nav = ui.getByRole('navigation', { name: 'Pages' })
    await page.keyboard.press('Alt+2')
    await expect(nav.getByRole('link', { name: /^Drops/ })).toHaveAttribute('aria-current', 'page')
    // Ctrl+F from a page without a search goes to the Library's, with focus in it; the outline
    // is on the whole field, icon included.
    await page.keyboard.press('Control+F')
    const searchBox = ui.getByRole('searchbox', { name: 'Search games' })
    await expect(searchBox).toBeFocused()
    await expect
      .poll(() => searchBox.evaluate((el) => getComputedStyle(el.parentElement!).outlineStyle))
      .toBe('solid')
    await page.keyboard.press('Alt+1')
    await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    // The game list is one Tab stop; the arrow keys move in it.
    const sideItems = games.locator('a, button')
    await expect(games.locator('[tabindex="0"]')).toHaveCount(1)
    await sideItems.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(sideItems.nth(1)).toBeFocused()
    await expect(sideItems.nth(1)).toHaveAttribute('tabindex', '0')
    await expect(sideItems.first()).toHaveAttribute('tabindex', '-1')
    // F1 opens the account menu with its first item focused; Escape closes it.
    await page.keyboard.press('F1')
    const accountMenu = page.getByRole('dialog', { name: 'Account' })
    await expect(accountMenu.getByRole('button').first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(accountMenu.getByRole('button').nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(accountMenu).toHaveCount(0)
    // Ctrl+R and F5 refresh the campaigns instead of reloading the window.
    const dashboards = (): number => twitch.gqlCalls.filter((op) => op === 'Inventory').length
    const refreshesBefore = dashboards()
    // Sent as the OS would: Playwright's own key presses skip the window's before-input-event.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'F5'
      })
    )
    await expect.poll(dashboards).toBeGreaterThan(refreshesBefore)
    await expect(searchBox).toBeVisible()

    // Settings, from the account menu: no queue rules any more (Twitch settled them).
    await ui.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(ui.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(ui.getByRole('heading', { name: 'Queue rules' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
