// Launches the built desktop app (apps/desktop/out) with an isolated user data directory.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAIN_ENTRY = fileURLToPath(
  new URL('../../apps/desktop/out/main/index.js', import.meta.url)
)

export function newUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tdc-e2e-'))
}

/** process.env without undefined values, minus anything that would switch the app to dev mode. */
export function appEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') env[key] = value
  }
  // Set TDC_E2E_SHOW_WINDOWS=1 to watch the tests; otherwise windows stay invisible.
  const invisible: Record<string, string> =
    process.env['TDC_E2E_SHOW_WINDOWS'] === '1' ? {} : { TDC_E2E_INVISIBLE: '1' }
  return { ...env, ...invisible, TDC_USER_DATA_DIR: userDataDir }
}

export async function launchApp(
  userDataDir = newUserDataDir()
): Promise<{ app: ElectronApplication; window: Page; userDataDir: string }> {
  const app = await electron.launch({ args: [MAIN_ENTRY], env: appEnv(userDataDir) })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window, userDataDir }
}
