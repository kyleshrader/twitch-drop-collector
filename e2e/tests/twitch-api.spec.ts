// The Twitch API checks: a response that no longer matches what the app expects is logged to
// logs/twitch-api.log (redacted), notified, and shown on the Twitch API page, where it can be
// opened, reported, dismissed, and all activity paused.
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp, logOf, newUserDataDir, twitchEndpoints } from './app'
import { startMockTwitch, type MockTwitch } from './mock-twitch'

let twitch: MockTwitch
test.beforeEach(async () => {
  twitch = await startMockTwitch()
})
test.afterEach(async () => {
  await twitch.close()
})

test('a changed Twitch response is logged, notified and shown with expected vs actual', async () => {
  const userDataDir = newUserDataDir()
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ version: 1, settings: {} }))
  // Twitch "changed" the avatar query: the picture comes back as a number, next to the user's
  // own ID and login (which must not end up in the log or the report).
  twitch.changed.set('UserAvatar', {
    user: { id: '4242', login: 'e2euser', profileImageURL: 70 }
  })
  const { app, window: page } = await launchApp(userDataDir, {
    TDC_TWITCH_ENDPOINTS: JSON.stringify(twitchEndpoints(twitch.url))
  })
  const ui = page.getByTestId('next-ui')
  try {
    await page.getByRole('button', { name: 'Sign in with Twitch' }).click()

    // The desktop notification (logged in test runs) gives the counts.
    await expect
      .poll(logOf(userDataDir), { timeout: 15_000 })
      .toMatch(/Notification[\s\S]{0,80}Twitch may have changed its API[\s\S]{0,80}1 error so far/)

    // Its own log file, with what was expected and what came back, and nothing personal.
    const logFile = join(userDataDir, 'logs', 'twitch-api.log')
    await expect.poll(() => existsSync(logFile)).toBe(true)
    const line = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n')[0]!) as {
      endpoint: string
      checks: { path: string; expected: unknown; actual: unknown }[]
    }
    expect(line.endpoint).toBe('UserAvatar')
    expect(line.checks[0]).toMatchObject({
      path: 'user.profileImageURL',
      expected: { type: ['string', 'null'] },
      actual: 70
    })
    expect(readFileSync(logFile, 'utf8')).not.toMatch(/4242|e2euser/)

    // The bell collects it into one notice, which opens the Twitch API page.
    await ui.getByRole('button', { name: 'Notifications' }).click()
    await ui.getByRole('button', { name: /Twitch API: 1 error/ }).click()
    await expect(ui.getByRole('heading', { name: 'Twitch API', level: 2 })).toBeVisible()
    const row = ui.getByTestId('api-issue')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('UserAvatar')

    // Test calls: one request on its own, with its (redacted) response.
    const calls = ui.getByTestId('api-call')
    const search = calls.filter({ hasText: 'SearchGames' })
    await search.getByRole('button', { name: 'Run SearchGames' }).click()
    await expect(search).toContainText(/Passed in \d+ ms/)
    await search.getByRole('button', { name: 'Response' }).click()
    await expect(search.locator('pre')).toContainText('searchCategories')
    // All of them: the avatar one still fails, and counts again on its issue.
    await ui.getByRole('button', { name: 'Run all' }).click()
    await expect(ui.getByRole('status').filter({ hasText: /requests passed/ })).toContainText(
      /^\d+ of \d+ requests passed/
    )
    await expect(calls.filter({ hasText: 'UserAvatar' })).toContainText(/Failed after \d+ ms/)
    await expect(row).toContainText('2 times')

    // The issue: where it differs, expected vs actual.
    await row.click()
    await expect(ui.getByText('user.profileImageURL', { exact: true })).toBeVisible()
    await expect(ui.locator('pre').first()).toContainText('"string"')
    await expect(ui.locator('pre').nth(1)).toHaveText('70')

    // Report on GitHub opens a filled-in new issue, without the user's ID or login.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await ui.getByRole('button', { name: 'Report on GitHub' }).click()
    const openedUrls = (): Promise<string[]> =>
      app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])
    await expect.poll(openedUrls).toHaveLength(1)
    const [opened = ''] = await openedUrls()
    const report = new URL(opened)
    expect(`${report.origin}${report.pathname}`).toBe(
      'https://github.com/kyleshrader/twitch-drop-collector/issues/new'
    )
    expect(report.searchParams.get('body')).toContain('user.profileImageURL')
    expect(opened).not.toMatch(/4242|e2euser/)

    // Pause all activity, then resume.
    await ui.getByRole('button', { name: 'Pause all activity' }).click()
    await expect(ui.getByText(/All activity is paused/)).toBeVisible()
    await ui.getByRole('button', { name: 'Resume' }).click()
    await expect(ui.getByRole('button', { name: 'Pause all activity' })).toBeVisible()

    // Dismissed: gone from the page, the bell and the Settings row.
    await ui.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(ui.getByText(/No problems found/)).toBeVisible()
    await page.evaluate(() => (location.hash = '#/settings'))
    const settingsRow = ui.getByText('Twitch API checks').locator('..').locator('..')
    await expect(settingsRow).toContainText('No problems')
    await settingsRow.getByRole('link', { name: 'Open' }).click()
    await expect(ui.getByRole('heading', { name: 'Twitch API', level: 2 })).toBeVisible()

    // Simulate a change: a made-up mismatch goes through the same log, notification and page.
    await ui.getByRole('button', { name: 'Simulate a change' }).click()
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Sample')
    await expect
      .poll(() => logOf(userDataDir)().match(/Twitch may have changed its API/g)?.length ?? 0)
      .toBe(2)
    await expect.poll(() => readFileSync(logFile, 'utf8')).toMatch(/"demo":true/)
  } finally {
    await app.close()
  }
})
