// Namespaced key/value cache with expiry. Values are JSON, and every read is validated against
// the caller's schema, so a stale shape from an older app version is dropped instead of trusted.
import type { Clock, Logger } from '@tdc/kernel'
import type { z } from 'zod'
import type { Database } from './database'

export interface Cache {
  /** The cached value, or undefined if missing, expired, or no longer matching the schema. */
  get<T>(namespace: string, key: string, schema: z.ZodType<T>): T | undefined
  set(namespace: string, key: string, value: unknown, ttlMs: number): void
  delete(namespace: string, key: string): void
  /** Clears one namespace, or everything when no namespace is given. */
  clear(namespace?: string): void
  /** Deletes all expired entries and returns how many were removed. */
  purgeExpired(): number
}

export function createCache(deps: { db: Database; clock: Clock; logger: Logger }): Cache {
  const { db, clock, logger } = deps
  const now = (): number => clock.now().getTime()

  const remove = (namespace: string, key: string): void => {
    db.run('DELETE FROM cache_entries WHERE namespace = ? AND key = ?', namespace, key)
  }

  return {
    get<T>(namespace: string, key: string, schema: z.ZodType<T>): T | undefined {
      const row = db.get(
        'SELECT value, expires_at FROM cache_entries WHERE namespace = ? AND key = ?',
        namespace,
        key
      )
      if (!row) return undefined
      if (Number(row['expires_at']) <= now()) {
        remove(namespace, key)
        return undefined
      }
      let json: unknown
      try {
        json = JSON.parse(String(row['value']))
      } catch {
        json = Symbol('unparseable')
      }
      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        logger.warn('Dropping a cache entry that no longer matches its schema', { namespace, key })
        remove(namespace, key)
        return undefined
      }
      return parsed.data
    },
    set(namespace, key, value, ttlMs): void {
      if (!(ttlMs > 0)) throw new RangeError('ttlMs must be positive')
      const at = now()
      db.run(
        `INSERT INTO cache_entries (namespace, key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (namespace, key) DO UPDATE SET
           value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
        namespace,
        key,
        JSON.stringify(value),
        at + ttlMs,
        at
      )
    },
    delete: remove,
    clear(namespace): void {
      if (namespace === undefined) db.run('DELETE FROM cache_entries')
      else db.run('DELETE FROM cache_entries WHERE namespace = ?', namespace)
    },
    purgeExpired(): number {
      return db.run('DELETE FROM cache_entries WHERE expires_at <= ?', now()).changes
    }
  }
}
