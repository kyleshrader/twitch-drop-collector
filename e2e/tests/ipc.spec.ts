import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './app'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, window: page } = await launchApp())
})

test.afterAll(async () => {
  await app.close()
})

/** Calls window.api.invoke from the renderer, exactly as page code would. */
function rawInvoke(channel: string, input?: unknown): Promise<unknown> {
  return page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).api.invoke(c, i),
    [channel, input] as const
  )
}

test('the renderer shows data from a real IPC round trip', async () => {
  const version = await app.evaluate(({ app }) => app.getVersion())
  await expect(page.getByTestId('app-version')).toContainText(`Version ${version}`)
})

test('main rejects an invalid payload sent from the renderer', async () => {
  const result = await rawInvoke('shell:openExternal', { url: 'file:///etc/passwd' })
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
})

test('the preload refuses channels outside the contract', async () => {
  expect(await rawInvoke('shell:runCommand', 'calc.exe')).toMatchObject({
    ok: false,
    error: { code: 'UNKNOWN_CHANNEL' }
  })
})

test('a valid request reaches the handler', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = async (url: string): Promise<void> => {
      opened.push(url)
    }
  })
  await page.getByRole('button', { name: 'Open Twitch drops inventory' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened))
    .toEqual(['https://www.twitch.tv/drops/inventory'])
})
