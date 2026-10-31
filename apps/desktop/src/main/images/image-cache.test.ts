import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Clock, Logger } from '@tdc/kernel'
import { openStorage } from '@tdc/storage'
import { describe, expect, it, vi } from 'vitest'
import { createImageCache } from './image-cache'

function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

const PNG = 'image/png'
const image = (bytes: number, type = PNG): Response =>
  new Response(Buffer.alloc(bytes, 7), { headers: { 'content-type': type } })

function setup(options: { maxBytes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tdc-images-'))
  let now = Date.parse('2026-10-31T12:00:00Z')
  const clock: Clock & { advance(ms: number): void } = {
    now: () => new Date(now),
    advance: (ms) => (now += ms)
  }
  const logger = testLogger()
  const storage = openStorage({ file: join(root, 'tdc.db'), clock, logger })
  const fetch = vi.fn<(url: string) => Promise<Response>>(async () => image(100))
  const dir = join(root, 'images')
  const cache = createImageCache({
    index: storage.images,
    dir,
    fetch,
    clock,
    logger,
    maxImageBytes: 1000,
    ...options
  })
  const files = (): string[] => (existsSync(dir) ? readdirSync(dir) : [])
  return { cache, fetch, clock, storage, dir, files }
}

const A = 'https://static-cdn.jtvnw.net/a.png'
const B = 'https://static-cdn.jtvnw.net/b.png'
const C = 'https://static-cdn.jtvnw.net/c.png'

describe('image cache', () => {
  it('fetches once, then serves from disk', async () => {
    const { cache, fetch, files } = setup()
    const first = await cache.get(A)
    const second = await cache.get(A)
    expect(first).toEqual({ body: Buffer.alloc(100, 7), contentType: PNG })
    expect(second).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatch(/^[0-9a-f]{64}\.png$/)
  })

  it('shares one request between callers asking at the same time', async () => {
    const { cache, fetch } = setup()
    const [one, two] = await Promise.all([cache.get(A), cache.get(A)])
    expect(one).toEqual(two)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches again when the file went missing', async () => {
    const { cache, fetch, dir, files } = setup()
    await cache.get(A)
    rmSync(join(dir, files()[0]!))
    expect(await cache.get(A)).toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses errors, non-images and oversized bodies, and waits before retrying', async () => {
    const { cache, fetch, clock, files } = setup()
    fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    expect(await cache.get(A)).toBeUndefined()
    expect(await cache.get(A)).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
    clock.advance(5 * 60_000)
    expect(await cache.get(A)).toBeDefined()

    fetch.mockResolvedValueOnce(image(10, 'text/html'))
    expect(await cache.get(B)).toBeUndefined()
    fetch.mockResolvedValueOnce(image(1001))
    expect(await cache.get(C)).toBeUndefined()
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await cache.get('https://static-cdn.jtvnw.net/d.png')).toBeUndefined()
    expect(files()).toHaveLength(1)
  })

  it('evicts the least recently shown once over the size limit', async () => {
    const { cache, clock, storage, files } = setup({ maxBytes: 250 })
    await cache.get(A)
    clock.advance(1000)
    await cache.get(B)
    clock.advance(1000)
    await cache.get(A) // A is now the most recently shown
    clock.advance(1000)
    await cache.get(C)
    await vi.waitFor(() => expect(files()).toHaveLength(2))
    expect(storage.images.totalBytes()).toBeLessThanOrEqual(250)
    expect(storage.images.get(B)).toBeUndefined()
    expect(storage.images.get(A)).toBeDefined()
  })

  it('evicts images not shown for 30 days', async () => {
    const { cache, clock, storage, files } = setup()
    await cache.get(A)
    clock.advance(20 * 24 * 60 * 60 * 1000)
    await cache.get(B)
    clock.advance(11 * 24 * 60 * 60 * 1000)
    expect(await cache.prune()).toBe(1)
    expect(storage.images.get(A)).toBeUndefined()
    expect(files()).toHaveLength(1)
  })
})
