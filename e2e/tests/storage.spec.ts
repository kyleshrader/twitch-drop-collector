// The real app creates and migrates its database at startup, inside Electron's runtime.
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchApp } from './app'

test('the app creates and migrates its database at startup', async () => {
  const { app, window: page, userDataDir } = await launchApp()
  try {
    await expect(page.getByTestId('app-version')).toContainText('Version')
    const file = join(userDataDir, 'tdc.db')
    expect(existsSync(file)).toBe(true)

    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const version = Number(db.prepare('PRAGMA user_version').get()?.['user_version'])
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row['name'])
      expect(version).toBeGreaterThanOrEqual(1)
      expect(tables).toEqual(expect.arrayContaining(['cache_entries', 'claims']))
    } finally {
      db.close()
    }
  } finally {
    await app.close()
  }
})
