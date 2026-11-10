// Records the trailer's scenes (media/trailer/SCRIPT.md) from the invisible app window. Each
// scene runs a little longer than its slot; compose.mjs trims and times it.
import { test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { DEMO_DATA, glide, hold, openStage, press, record, scrollBy } from './stage'

test('trailer scenes', async () => {
  test.skip(!existsSync(DEMO_DATA), 'run media/trailer/demo-data.mjs first')
  const stage = await openStage()
  const { page } = stage
  const ui = page.getByTestId('next-ui')
  try {
    // 1 · It watches for you: Current, the channel menu, the drops.
    await page.evaluate(() => (location.hash = '#/drops'))
    await hold(page, 800)
    const current = ui.getByRole('region', { name: 'Current' })
    await record(stage, '1-drops', async () => {
      await hold(page, 900)
      await press(page, current.getByRole('button', { name: 'Change channel' }), 900)
      await hold(page, 1600)
      await page.keyboard.press('Escape')
      await hold(page, 400)
      await glide(page, current.getByRole('progressbar').first(), 700)
      await hold(page, 1100)
      // Off the channel lists, whose tooltips would pop up as the page scrolls under the mouse.
      await glide(page, { x: 1240, y: 300 }, 500)
      await scrollBy(page, 260, 1100)
      await hold(page, 1400)
    })

    // 2 · Your queue, your order: sort, move, collect now.
    const upNext = ui.getByRole('region', { name: 'Up next' })
    await upNext.scrollIntoViewIfNeeded()
    await record(stage, '2-upnext', async () => {
      await hold(page, 350)
      await press(page, upNext.getByRole('button', { name: 'Sort Up next' }), 800)
      await hold(page, 900)
      await press(page, page.getByRole('radio', { name: /^Ending soonest/ }), 700)
      await hold(page, 650)
      const second = upNext.getByTestId('queue-card').nth(1)
      const game = (await second.getAttribute('aria-label')) ?? ''
      await press(page, second.getByRole('button', { name: `Actions for ${game}` }).first(), 800)
      await hold(page, 500)
      await press(page, page.getByRole('button', { name: 'Move up' }), 600)
      await hold(page, 800)
      await press(page, upNext.getByRole('button', { name: 'Collect now' }).first(), 800)
      await hold(page, 1100)
    })

    // 3 · Every game in one library.
    await record(stage, '3-library', async () => {
      await press(page, ui.getByRole('link', { name: 'Library' }), 700)
      await hold(page, 900)
      await glide(page, { x: 900, y: 420 }, 600)
      await scrollBy(page, 420, 1000)
      await hold(page, 350)
      const tile = ui
        .getByRole('main')
        .getByRole('link', { name: /^Overwatch/ })
        .first()
      await press(page, tile, 800)
      await hold(page, 1000)
      await press(page, ui.getByRole('button', { name: /Show the drops in/ }).first(), 700)
      await hold(page, 1200)
    })

    // 4 · See everything it did.
    await record(stage, '4-history', async () => {
      await press(page, ui.getByRole('link', { name: 'History' }), 700)
      await hold(page, 1100)
      await press(page, ui.getByRole('button', { name: /^Drops claimed/ }), 800)
      await hold(page, 1000)
      await press(page, ui.getByRole('button', { name: /^Drops claimed/ }), 500)
      await hold(page, 350)
      const games = ui.getByRole('complementary', { name: 'Games' })
      await press(page, games.getByRole('button').nth(1), 800)
      await hold(page, 1100)
      await press(page, ui.getByRole('button', { name: 'All games', exact: true }), 700)
      await hold(page, 280)
      await press(page, ui.getByRole('searchbox'), 600)
      await page.keyboard.type('hat', { delay: 140 })
      await hold(page, 1200)
    })

    // 5 · Ready when Twitch changes.
    await page.getByRole('searchbox').fill('')
    await record(stage, '5-twitch-api', async () => {
      await page.evaluate(() => (location.hash = '#/twitch-api'))
      await hold(page, 900)
      await press(page, ui.getByRole('button', { name: 'Simulate a change' }), 800)
      await hold(page, 1100)
      await press(page, ui.getByTestId('api-issue').first(), 700)
      await hold(page, 2400)
    })

    // 6 · Dark, light, or your system's.
    await record(stage, '6-themes', async () => {
      await page.evaluate(() => (location.hash = '#/settings'))
      await hold(page, 700)
      const themes = ui.getByRole('group', { name: 'Theme' })
      await press(page, themes.getByRole('button', { name: 'Light' }), 700)
      await hold(page, 1300)
      await press(page, themes.getByRole('button', { name: 'Dark' }), 600)
      await hold(page, 900)
    })
  } finally {
    await stage.close()
  }
})
