// Index of the remote images cached on disk. The files themselves are written by the app; this only
// records which URL is in which file, how big it is, and when it was last shown.
import type { Database, Row } from './database'

export interface ImageEntry {
  url: string
  /** File name inside the image folder. */
  file: string
  contentType: string
  bytes: number
  fetchedAt: Date
  usedAt: Date
}

export interface ImageIndex {
  get(url: string): ImageEntry | undefined
  put(entry: ImageEntry): void
  /** Marks an image as just shown, so it is evicted last. */
  touch(url: string, at: Date): void
  remove(url: string): void
  totalBytes(): number
  /** Least recently shown first. */
  oldest(limit: number): ImageEntry[]
  /** Images not shown since `before`. */
  unusedSince(before: Date): ImageEntry[]
}

function toEntry(row: Row): ImageEntry {
  return {
    url: String(row['url']),
    file: String(row['file']),
    contentType: String(row['content_type']),
    bytes: Number(row['bytes']),
    fetchedAt: new Date(Number(row['fetched_at'])),
    usedAt: new Date(Number(row['used_at']))
  }
}

export function createImageIndex(deps: { db: Database }): ImageIndex {
  const { db } = deps
  return {
    get(url) {
      const row = db.get('SELECT * FROM images WHERE url = ?', url)
      return row ? toEntry(row) : undefined
    },
    put(entry) {
      db.run(
        `INSERT INTO images (url, file, content_type, bytes, fetched_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET
           file = excluded.file, content_type = excluded.content_type, bytes = excluded.bytes,
           fetched_at = excluded.fetched_at, used_at = excluded.used_at`,
        entry.url,
        entry.file,
        entry.contentType,
        entry.bytes,
        entry.fetchedAt.getTime(),
        entry.usedAt.getTime()
      )
    },
    touch(url, at) {
      db.run('UPDATE images SET used_at = ? WHERE url = ?', at.getTime(), url)
    },
    remove(url) {
      db.run('DELETE FROM images WHERE url = ?', url)
    },
    totalBytes() {
      return Number(db.get('SELECT COALESCE(SUM(bytes), 0) AS total FROM images')?.['total'] ?? 0)
    },
    oldest(limit) {
      return db
        .all('SELECT * FROM images ORDER BY used_at, url LIMIT ?', Math.max(0, limit))
        .map(toEntry)
    },
    unusedSince(before) {
      return db
        .all('SELECT * FROM images WHERE used_at < ? ORDER BY used_at, url', before.getTime())
        .map(toEntry)
    }
  }
}
