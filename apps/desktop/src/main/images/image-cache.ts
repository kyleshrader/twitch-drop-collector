// Box art and reward images, fetched once by main and kept on disk (upstream's cache.py). Files
// are named by a hash of their URL; the index in @tdc/storage records size and last use, so the
// least recently shown are evicted first once the folder is over its size limit.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FetchLike } from '@tdc/api'
import type { Clock, Logger } from '@tdc/kernel'
import type { ImageEntry, ImageIndex } from '@tdc/storage'

/** The image types served, with the extension their files get. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif'
}

export interface CachedImage {
  body: Buffer
  contentType: string
}

export interface ImageCache {
  /** The image, from disk or fetched now; undefined if it can't be had. */
  get(url: string): Promise<CachedImage | undefined>
  /** Evicts images unused for too long, then the least recently used while over the size limit. */
  prune(): Promise<number>
}

const DAY_MS = 24 * 60 * 60 * 1000

export function createImageCache(deps: {
  index: ImageIndex
  dir: string
  fetch: FetchLike
  clock: Clock
  logger: Logger
  maxBytes?: number
  maxImageBytes?: number
  unusedForMs?: number
  timeoutMs?: number
  /** How long a URL that failed is not asked for again. */
  retryAfterMs?: number
}): ImageCache {
  const {
    index,
    dir,
    clock,
    logger,
    maxBytes = 200 * 1024 * 1024,
    maxImageBytes = 5 * 1024 * 1024,
    unusedForMs = 30 * DAY_MS,
    timeoutMs = 30_000,
    retryAfterMs = 5 * 60_000
  } = deps
  const now = (): number => clock.now().getTime()
  const inFlight = new Map<string, Promise<CachedImage | undefined>>()
  const failedAt = new Map<string, number>()

  const evict = async (entry: ImageEntry): Promise<void> => {
    index.remove(entry.url)
    await rm(join(dir, entry.file), { force: true })
  }

  async function prune(): Promise<number> {
    let evicted = 0
    for (const entry of index.unusedSince(new Date(now() - unusedForMs))) {
      await evict(entry)
      evicted++
    }
    while (index.totalBytes() > maxBytes) {
      const batch = index.oldest(20)
      if (batch.length === 0) break
      for (const entry of batch) {
        await evict(entry)
        evicted++
        if (index.totalBytes() <= maxBytes) break
      }
    }
    if (evicted > 0) logger.debug('Evicted cached images', { evicted })
    return evicted
  }

  const failed = (url: string, why: string, fields: Record<string, unknown> = {}): undefined => {
    failedAt.set(url, now())
    logger.debug(`Image not cached: ${why}`, { url, ...fields })
    return undefined
  }

  async function download(url: string): Promise<CachedImage | undefined> {
    let response: Response
    try {
      response = await deps.fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      return failed(url, 'request failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
    if (!response.ok) return failed(url, 'bad status', { status: response.status })
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
    const extension = IMAGE_TYPES[contentType.toLowerCase()]
    if (!extension) return failed(url, 'not an image type it serves', { contentType })
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > maxImageBytes) return failed(url, 'too large', { bytes: declared })
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxImageBytes) return failed(url, 'too large', { bytes: body.length })

    const file = `${createHash('sha256').update(url).digest('hex')}.${extension}`
    await mkdir(dir, { recursive: true })
    const temporary = join(dir, `${file}.${process.pid}.tmp`)
    await writeFile(temporary, body)
    await rename(temporary, join(dir, file))
    const at = clock.now()
    index.put({ url, file, contentType, bytes: body.length, fetchedAt: at, usedAt: at })
    if (index.totalBytes() > maxBytes) void prune().catch(() => {})
    return { body, contentType }
  }

  async function fromDisk(url: string): Promise<CachedImage | undefined> {
    const entry = index.get(url)
    if (!entry) return undefined
    try {
      const body = await readFile(join(dir, entry.file))
      index.touch(url, clock.now())
      return { body, contentType: entry.contentType }
    } catch {
      // The file went missing (cleaned up by hand, or a failed write): fetch it again.
      index.remove(url)
      return undefined
    }
  }

  return {
    async get(url) {
      const cached = await fromDisk(url)
      if (cached) return cached
      const lastFailure = failedAt.get(url)
      if (lastFailure !== undefined && now() - lastFailure < retryAfterMs) return undefined

      let pending = inFlight.get(url)
      if (!pending) {
        pending = download(url)
          .catch((error: unknown) =>
            failed(url, 'could not be saved', {
              error: error instanceof Error ? error.message : String(error)
            })
          )
          .finally(() => inFlight.delete(url))
        inFlight.set(url, pending)
      }
      return pending
    },
    prune
  }
}
