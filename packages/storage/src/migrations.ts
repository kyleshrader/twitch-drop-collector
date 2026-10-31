// Schema migrations, tracked with PRAGMA user_version. MIGRATIONS[i] takes the database from
// version i to i + 1. Never edit a released migration; append a new one.
import type { Database } from './database'

export const MIGRATIONS: readonly string[] = [
  // 1: generic expiring cache and claim history
  `
  CREATE TABLE cache_entries (
    namespace  TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
  ) STRICT;
  CREATE INDEX cache_entries_expires_at ON cache_entries (expires_at);

  CREATE TABLE claims (
    drop_id     TEXT    NOT NULL PRIMARY KEY,
    campaign_id TEXT    NOT NULL,
    game_name   TEXT    NOT NULL,
    drop_name   TEXT    NOT NULL,
    rewards     TEXT    NOT NULL,
    claimed_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX claims_claimed_at ON claims (claimed_at DESC);
  `,
  // 2: index of the image files cached on disk
  `
  CREATE TABLE images (
    url          TEXT    NOT NULL PRIMARY KEY,
    file         TEXT    NOT NULL,
    content_type TEXT    NOT NULL,
    bytes        INTEGER NOT NULL,
    fetched_at   INTEGER NOT NULL,
    used_at      INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX images_used_at ON images (used_at);
  `
]

export class NewerDatabaseError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(`Database is version ${found}, but this app supports up to ${supported}`)
    this.name = 'NewerDatabaseError'
  }
}

export function schemaVersion(db: Database): number {
  return Number(db.get('PRAGMA user_version')?.['user_version'] ?? 0)
}

/** Applies every pending migration, each in its own transaction. Returns the versions applied. */
export function runMigrations(db: Database, migrations: readonly string[] = MIGRATIONS): number[] {
  const current = schemaVersion(db)
  if (current > migrations.length) throw new NewerDatabaseError(current, migrations.length)

  const applied: number[] = []
  for (let version = current + 1; version <= migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version - 1]!)
      // PRAGMA can't take bound parameters; version is a trusted integer.
      db.exec(`PRAGMA user_version = ${version}`)
    })
    applied.push(version)
  }
  return applied
}
