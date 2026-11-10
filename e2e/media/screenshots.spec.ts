// The site's and README's screenshots (site/media/shots/), from the same demo stage as the
// trailer: 1440 × 810, no cursor.
import { test, type Page } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_DATA, hold, openStage, TRAILER } from './stage'

const SHOTS = join(TRAILER, '..', '..', 'site', 'media', 'shots')

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.getElementById('stage-cursor')?.remove())
  await page.mouse.move(-10, -10)
  await hold(page, 500)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

test('site screenshots', async () => {
  test.skip(!existsSync(DEMO_DATA), 'run media/trailer/demo-data.mjs first')
  mkdirSync(SHOTS, { recursive: true })
  const stage = await openStage()
  const { page } = stage
  const ui = page.getByTestId('next-ui')
  const go = async (hash: string): Promise<void> => {
    await page.evaluate((h) => (location.hash = h), hash)
    await hold(page, 900)
  }
  try {
    await go('#/drops')
    await shot(page, 'drops')

    const upNext = ui.getByRole('region', { name: 'Up next' })
    await upNext.scrollIntoViewIfNeeded()
    await upNext.getByRole('button', { name: 'Sort Up next' }).click()
    await shot(page, 'up-next-sort')
    await page.keyboard.press('Escape')

    await go('#/library')
    await shot(page, 'library')
    await ui
      .getByRole('main')
      .getByRole('link', { name: /^Overwatch/ })
      .first()
      .click()
    await hold(page, 600)
    await ui
      .getByRole('button', { name: /Show the drops in/ })
      .first()
      .click()
    await shot(page, 'game')

    await go('#/history')
    await shot(page, 'history')
    await ui.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Campaigns' }).click()
    await ui
      .getByRole('group', { name: 'Time range' })
      .getByRole('button', { name: 'All time' })
      .click()
    await shot(page, 'history-campaigns')
    await ui
      .getByRole('group', { name: 'Show' })
      .getByRole('button', { name: 'Everything' })
      .click()
    await ui
      .getByRole('group', { name: 'Time range' })
      .getByRole('button', { name: '30 days' })
      .click()

    await go('#/twitch-api')
    await ui.getByRole('button', { name: 'Simulate a change' }).click()
    await hold(page, 400)
    await ui.getByTestId('api-issue').first().click()
    await shot(page, 'twitch-api')

    await page.evaluate(() =>
      (
        window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).api.invoke('settings:update', { general: { theme: 'light' } })
    )
    await go('#/drops')
    await shot(page, 'drops-light')
    await go('#/history')
    await shot(page, 'history-light')
  } finally {
    await stage.close()
  }
})
