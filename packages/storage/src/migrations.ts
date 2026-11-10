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
  `,
  // 3: when each campaign was first seen (the start of the local history)
  `
  CREATE TABLE campaigns_seen (
    campaign_id   TEXT    NOT NULL PRIMARY KEY,
    game_id       TEXT    NOT NULL,
    game_name     TEXT    NOT NULL,
    campaign_name TEXT    NOT NULL,
    first_seen_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX campaigns_seen_game ON campaigns_seen (game_id);
  `,
  // 4: what the app knows about games by name (address and box art), refreshed over time
  `
  CREATE TABLE games (
    name        TEXT    NOT NULL PRIMARY KEY,
    game_id     TEXT,
    slug        TEXT,
    box_art_url TEXT,
    checked_at  INTEGER NOT NULL
  ) STRICT;
  `,
  // 5: the History page: each claim's picture and where its time came from, how each campaign
  // stood when last seen (to tell completed from missed once it ends), and what was watched
  `
  ALTER TABLE claims ADD COLUMN image_url TEXT;
  ALTER TABLE claims ADD COLUMN source TEXT NOT NULL DEFAULT 'app';
  ALTER TABLE campaigns_seen ADD COLUMN starts_at INTEGER;
  ALTER TABLE campaigns_seen ADD COLUMN ends_at INTEGER;
  ALTER TABLE campaigns_seen ADD COLUMN drops_total INTEGER;
  ALTER TABLE campaigns_seen ADD COLUMN drops_claimed INTEGER;
  ALTER TABLE campaigns_seen ADD COLUMN earnable INTEGER;
  ALTER TABLE campaigns_seen ADD COLUMN last_seen_at INTEGER;
  CREATE INDEX campaigns_seen_ends_at ON campaigns_seen (ends_at);

  CREATE TABLE watch_sessions (
    id            INTEGER PRIMARY KEY,
    channel_login TEXT    NOT NULL,
    channel_name  TEXT    NOT NULL,
    game_name     TEXT    NOT NULL,
    campaign_id   TEXT,
    campaign_name TEXT,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX watch_sessions_started_at ON watch_sessions (started_at DESC);
  `,
  // 6: things that happened in the app, for the History page (list changes, links, pauses)
  `
  CREATE TABLE events (
    id   INTEGER PRIMARY KEY,
    kind TEXT    NOT NULL,
    at   INTEGER NOT NULL,
    data TEXT    NOT NULL
  ) STRICT;
  CREATE INDEX events_at ON events (at);
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
