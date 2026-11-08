import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createJsonFileStore, renameWithRetry } from './json-file-store'

const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const logger = { warn: vi.fn() } as never

describe('renameWithRetry', () => {
  it('retries while Windows reports the file busy, then succeeds', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(busy('EPERM'))
      .mockRejectedValueOnce(busy('EBUSY'))
      .mockResolvedValueOnce(undefined)
    await renameWithRetry('a', 'b', { rename, delayMs: 0 })
    expect(rename).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last attempt, and at once on other errors', async () => {
    const stillBusy = vi.fn().mockRejectedValue(busy('EACCES'))
    await expect(
      renameWithRetry('a', 'b', { rename: stillBusy, attempts: 3, delayMs: 0 })
    ).rejects.toThrow('EACCES')
    expect(stillBusy).toHaveBeenCalledTimes(3)

    const missing = vi.fn().mockRejectedValue(busy('ENOENT'))
    await expect(renameWithRetry('a', 'b', { rename: missing, delayMs: 0 })).rejects.toThrow(
      'ENOENT'
    )
    expect(missing).toHaveBeenCalledTimes(1)
  })
})

describe('the JSON file store', () => {
  it('writes the whole file and reads it back', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tdc-store-')), 'nested', 'settings.json')
    const store = createJsonFileStore({ file, logger })
    expect(await store.read()).toBeUndefined()
    await store.write({ version: 1, settings: { a: 1 } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, settings: { a: 1 } })
    expect(await store.read()).toEqual({ version: 1, settings: { a: 1 } })
  })
})
