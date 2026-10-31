// Opens the app database, migrates it, and builds the repositories on top. A database that
// can't be opened (corrupt, or written by a newer app version) is moved aside, not deleted, and
// a fresh one is created: everything in it is cache or history the app can rebuild.
import type { Clock, Logger } from '@tdc/kernel'
import { existsSync, renameSync } from 'node:fs'
import { createCache, type Cache } from './cache'
import { createClaimHistory, type ClaimHistory } from './claims'
import { createImageIndex, type ImageIndex } from './images'
import { openSqlite, type Database } from './database'
import { MIGRATIONS, runMigrations } from './migrations'

export interface Storage {
  cache: Cache
  claims: ClaimHistory
  images: ImageIndex
  close(): void
}

function openAndMigrate(
  file: string,
  migrations: readonly string[]
): { db: Database; applied: number[] } {
  const db = openSqlite(file)
  try {
    return { db, applied: runMigrations(db, migrations) }
  } catch (error) {
    db.close()
    throw error
  }
}

export function openStorage(deps: {
  file: string
  clock: Clock
  logger: Logger
  migrations?: readonly string[]
}): Storage {
  const { file, clock, logger, migrations = MIGRATIONS } = deps

  let opened: { db: Database; applied: number[] }
  try {
    opened = openAndMigrate(file, migrations)
  } catch (error) {
    const backup = `${file}.unusable-${clock.now().toISOString().replace(/[:.]/g, '-')}`
    logger.warn('Database could not be opened; moving it aside and starting fresh', {
      error: error instanceof Error ? error.message : String(error),
      backup
    })
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix)
    }
    opened = openAndMigrate(file, migrations)
  }

  const { db, applied } = opened
  if (applied.length > 0) logger.info('Database migrated', { applied })

  return {
    cache: createCache({ db, clock, logger }),
    claims: createClaimHistory({ db }),
    images: createImageIndex({ db }),
    close: () => db.close()
  }
}
