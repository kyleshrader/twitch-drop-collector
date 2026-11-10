import type { Clock, Logger } from '@tdc/kernel'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { openSqlite } from './database'
import { MIGRATIONS, NewerDatabaseError, runMigrations, schemaVersion } from './migrations'
import { createGames } from './games'
import { createClaimHistory } from './claims'
import { createEventLog } from './events'
import { createSeenCampaigns } from './seen'
import { createWatchLog } from './watch-log'
import { openStorage } from './storage'

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

function fakeClock(start = Date.parse('2026-10-30T12:00:00Z')): Clock & {
  advance(ms: number): void
} {
  let now = start
  return { now: () => new Date(now), advance: (ms) => (now += ms) }
}

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'tdc-db-')), 'tdc.db')

describe('runtime', () => {
  it('runs inside Electron when started by test:electron', () => {
    if (process.env['ELECTRON_RUN_AS_NODE'] === '1') {
      expect(process.versions['electron']).toBeDefined()
    }
    const db = openSqlite(':memory:')
    expect(String(db.get('SELECT sqlite_version() AS v')?.['v'])).toMatch(/^3\./)
    db.close()
  })
})

describe('migrations', () => {
  it('creates the schema on a fresh database', () => {
    const db = openSqlite(tempFile())
    expect(runMigrations(db)).toEqual(MIGRATIONS.map((_, i) => i + 1))
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    const tables = db
      .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((row) => row['name'])
    expect(tables).toEqual([
      'cache_entries',
      'campaigns_seen',
      'claims',
      'events',
      'games',
      'images',
      'watch_sessions'
    ])
    db.close()
  })

  it('applies nothing the second time', () => {
    const file = tempFile()
    const first = openSqlite(file)
    runMigrations(first)
    first.close()
    const second = openSqlite(file)
    expect(runMigrations(second)).toEqual([])
    second.close()
  })

  it('applies only pending migrations, in order', () => {
    const db = openSqlite(tempFile())
    runMigrations(db, ['CREATE TABLE a (x INTEGER) STRICT'])
    expect(
      runMigrations(db, [
        'CREATE TABLE a (x INTEGER) STRICT',
        'ALTER TABLE a ADD COLUMN y TEXT',
        "INSERT INTO a (x, y) VALUES (1, 'z')"
      ])
    ).toEqual([2, 3])
    expect(db.get('SELECT x, y FROM a')).toEqual({ x: 1, y: 'z' })
    db.close()
  })

  it('rolls back a failing migration and keeps the old version', () => {
    const db = openSqlite(tempFile())
    expect(() =>
      runMigrations(db, ['CREATE TABLE ok (x INTEGER)', 'CREATE TABLE half (x); NOT SQL'])
    ).toThrow()
    expect(schemaVersion(db)).toBe(1)
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'half'")).toBeUndefined()
    db.close()
  })

  it('refuses a database from a newer app version', () => {
    const db = openSqlite(tempFile())
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    expect(() => runMigrations(db)).toThrow(NewerDatabaseError)
    db.close()
  })
})

describe('openStorage', () => {
  it('creates and migrates the database file', () => {
    const file = tempFile()
    const logger = testLogger()
    const storage = openStorage({ file, clock: fakeClock(), logger })
    expect(existsSync(file)).toBe(true)
    expect(logger.info).toHaveBeenCalledWith('Database migrated', {
      applied: MIGRATIONS.map((_, i) => i + 1)
    })
    storage.close()
  })

  it('keeps data across reopen', () => {
    const file = tempFile()
    const clock = fakeClock()
    const first = openStorage({ file, clock, logger: testLogger() })
    first.cache.set('games', 'rust', { id: 1 }, 60_000)
    first.close()
    const second = openStorage({ file, clock, logger: testLogger() })
    expect(second.cache.get('games', 'rust', z.object({ id: z.number() }))).toEqual({ id: 1 })
    second.close()
  })

  it('refuses a database from a newer version and leaves it in place', () => {
    const file = tempFile()
    const db = openSqlite(file)
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`)
    db.close()
    expect(() => openStorage({ file, clock: fakeClock(), logger: testLogger() })).toThrow(
      NewerDatabaseError
    )
    expect(readdirSync(join(file, '..'))).toEqual(['tdc.db'])
    const reopened = openSqlite(file)
    expect(schemaVersion(reopened)).toBe(MIGRATIONS.length + 5)
    reopened.close()
  })

  it('moves a corrupt file aside and starts fresh', () => {
    const file = tempFile()
    writeFileSync(file, 'this is not a database')
    const logger = testLogger()
    const storage = openStorage({ file, clock: fakeClock(), logger })

    storage.cache.set('n', 'k', 1, 1000)
    expect(storage.cache.get('n', 'k', z.number())).toBe(1)
    expect(logger.warn).toHaveBeenCalled()
    const files = readdirSync(join(file, '..'))
    expect(files.some((name) => name.startsWith('tdc.db.unusable-2026-10-30T12-00-00-000Z'))).toBe(
      true
    )
    storage.close()
  })
})

describe('cache', () => {
  const Game = z.object({ id: z.number(), name: z.string() })

  function setup(): {
    storage: ReturnType<typeof openStorage>
    clock: ReturnType<typeof fakeClock>
    logger: Logger
  } {
    const clock = fakeClock()
    const logger = testLogger()
    return { storage: openStorage({ file: tempFile(), clock, logger }), clock, logger }
  }

  it('returns values until they expire', () => {
    const { storage, clock } = setup()
    storage.cache.set('games', '1', { id: 1, name: 'Rust' }, 10_000)
    clock.advance(9_999)
    expect(storage.cache.get('games', '1', Game)).toEqual({ id: 1, name: 'Rust' })
    clock.advance(1)
    expect(storage.cache.get('games', '1', Game)).toBeUndefined()
    storage.close()
  })

  it('overwrites a key and refreshes its expiry', () => {
    const { storage, clock } = setup()
    storage.cache.set('games', '1', { id: 1, name: 'Old' }, 1_000)
    clock.advance(900)
    storage.cache.set('games', '1', { id: 1, name: 'New' }, 1_000)
    clock.advance(900)
    expect(storage.cache.get('games', '1', Game)?.name).toBe('New')
    storage.close()
  })

  it('drops entries that no longer match the schema', () => {
    const { storage, logger } = setup()
    storage.cache.set('games', '1', { id: '1', title: 'old shape' }, 60_000)
    expect(storage.cache.get('games', '1', Game)).toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
    // Removed, so a looser schema finds nothing either.
    expect(storage.cache.get('games', '1', z.unknown())).toBeUndefined()
    storage.close()
  })

  it('keeps namespaces separate and clears them independently', () => {
    const { storage } = setup()
    storage.cache.set('a', 'k', 1, 60_000)
    storage.cache.set('b', 'k', 2, 60_000)
    expect(storage.cache.get('a', 'k', z.number())).toBe(1)
    expect(storage.cache.get('b', 'k', z.number())).toBe(2)
    storage.cache.clear('a')
    expect(storage.cache.get('a', 'k', z.number())).toBeUndefined()
    expect(storage.cache.get('b', 'k', z.number())).toBe(2)
    storage.cache.clear()
    expect(storage.cache.get('b', 'k', z.number())).toBeUndefined()
    storage.close()
  })

  it('purges only expired entries', () => {
    const { storage, clock } = setup()
    storage.cache.set('n', 'short', 1, 1_000)
    storage.cache.set('n', 'long', 2, 10_000)
    clock.advance(5_000)
    expect(storage.cache.purgeExpired()).toBe(1)
    expect(storage.cache.get('n', 'long', z.number())).toBe(2)
    storage.close()
  })

  it.each([0, -1, Number.NaN])('rejects a ttl of %s', (ttl) => {
    const { storage } = setup()
    expect(() => storage.cache.set('n', 'k', 1, ttl)).toThrow(RangeError)
    storage.close()
  })

  it('treats keys as data, not SQL', () => {
    const { storage } = setup()
    const key = "x'); DROP TABLE cache_entries; --"
    storage.cache.set('n', key, 'safe', 60_000)
    expect(storage.cache.get('n', key, z.string())).toBe('safe')
    storage.close()
  })
})

describe('claim history', () => {
  const claim = (
    dropId: string,
    at: string
  ): Parameters<ReturnType<typeof openStorage>['claims']['record']>[0] => ({
    dropId,
    campaignId: 'campaign-1',
    gameName: 'Rust',
    dropName: `Drop ${dropId}`,
    rewards: ['Hoodie', 'Pants'],
    claimedAt: new Date(at)
  })

  it('records each drop once and lists the most recent first', () => {
    const storage = openStorage({ file: tempFile(), clock: fakeClock(), logger: testLogger() })
    expect(storage.claims.record(claim('a', '2026-10-01T00:00:00Z'))).toBe(true)
    expect(storage.claims.record(claim('b', '2026-10-03T00:00:00Z'))).toBe(true)
    expect(storage.claims.record(claim('c', '2026-10-02T00:00:00Z'))).toBe(true)
    expect(storage.claims.record(claim('a', '2026-10-09T00:00:00Z'))).toBe(false)

    expect(storage.claims.has('a')).toBe(true)
    expect(storage.claims.has('z')).toBe(false)
    expect(storage.claims.recent(2).map((c) => c.dropId)).toEqual(['b', 'c'])
    expect(storage.claims.recent(10)[2]).toEqual(claim('a', '2026-10-01T00:00:00Z'))
    // The first claim of a drop is the one kept.
    expect(storage.claims.claimTimes().get('a')).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(storage.claims.claimTimes().size).toBe(3)
    storage.close()
  })
})

describe('image index', () => {
  const entry = (url: string, usedAt: string, bytes = 100) => ({
    url,
    file: `${url.length}.png`,
    contentType: 'image/png',
    bytes,
    fetchedAt: new Date('2026-10-01T00:00:00Z'),
    usedAt: new Date(usedAt)
  })

  it('stores, replaces and removes entries, and sums their size', () => {
    const storage = openStorage({ file: tempFile(), clock: fakeClock(), logger: testLogger() })
    storage.images.put(entry('https://x/a.png', '2026-10-02T00:00:00Z'))
    storage.images.put(entry('https://x/b.png', '2026-10-03T00:00:00Z', 50))
    storage.images.put(entry('https://x/a.png', '2026-10-04T00:00:00Z', 70))
    expect(storage.images.get('https://x/a.png')).toEqual(
      entry('https://x/a.png', '2026-10-04T00:00:00Z', 70)
    )
    expect(storage.images.totalBytes()).toBe(120)
    storage.images.remove('https://x/a.png')
    expect(storage.images.get('https://x/a.png')).toBeUndefined()
    expect(storage.images.totalBytes()).toBe(50)
    storage.close()
  })

  it('orders by last use, which touch moves forward', () => {
    const storage = openStorage({ file: tempFile(), clock: fakeClock(), logger: testLogger() })
    storage.images.put(entry('https://x/a.png', '2026-10-02T00:00:00Z'))
    storage.images.put(entry('https://x/b.png', '2026-10-03T00:00:00Z'))
    storage.images.put(entry('https://x/c.png', '2026-10-04T00:00:00Z'))
    storage.images.touch('https://x/a.png', new Date('2026-10-05T00:00:00Z'))
    expect(storage.images.oldest(2).map((e) => e.url)).toEqual([
      'https://x/b.png',
      'https://x/c.png'
    ])
    expect(storage.images.unusedSince(new Date('2026-10-04T00:00:00Z')).map((e) => e.url)).toEqual([
      'https://x/b.png'
    ])
    storage.close()
  })
})

describe('transactions', () => {
  it('rolls back everything when the callback throws', () => {
    const db = openSqlite(tempFile())
    db.exec('CREATE TABLE t (x INTEGER) STRICT')
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (x) VALUES (?)', 1)
        throw new Error('nope')
      })
    ).toThrow('nope')
    expect(db.all('SELECT x FROM t')).toEqual([])
    db.transaction(() => db.run('INSERT INTO t (x) VALUES (?)', 2))
    expect(db.all('SELECT x FROM t')).toEqual([{ x: 2 }])
    db.close()
  })
})

describe('campaigns seen', () => {
  it('keeps the first time each campaign was seen and counts them by game', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const seen = createSeenCampaigns({ db })
    const first = new Date('2026-11-01T10:00:00Z')
    const later = new Date('2026-11-05T10:00:00Z')
    const rust = { gameId: 'g1', gameName: 'Rust' }
    expect(seen.record([{ id: 'a', name: 'A', ...rust }], first)).toBe(1)
    expect(
      seen.record(
        [
          { id: 'a', name: 'A', ...rust },
          { id: 'b', name: 'B', ...rust },
          { id: 'c', name: 'C', gameId: 'g2', gameName: 'Rocket League' }
        ],
        later
      )
    ).toBe(2)
    expect(seen.firstSeen()).toEqual(
      new Map([
        ['a', first],
        ['b', later],
        ['c', later]
      ])
    )
    expect(seen.countByGame()).toEqual(
      new Map([
        ['g1', 2],
        ['g2', 1]
      ])
    )
    db.close()
  })
})

describe('games', () => {
  it('saves what is known about a game and keeps fields a later save lacks', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const games = createGames({ db })
    const first = new Date('2026-11-01T10:00:00Z')
    const later = new Date('2026-11-05T10:00:00Z')
    games.save([{ name: 'ROBLOX', id: '23020', slug: 'roblox', boxArtUrl: 'a.jpg' }], first)
    games.save([{ name: 'ROBLOX', boxArtUrl: 'b.jpg' }, { name: 'Rob Run' }], later)
    expect(games.all()).toEqual(
      new Map([
        [
          'ROBLOX',
          { name: 'ROBLOX', id: '23020', slug: 'roblox', boxArtUrl: 'b.jpg', checkedAt: later }
        ],
        ['Rob Run', { name: 'Rob Run', checkedAt: later }]
      ])
    )
    db.close()
  })
})

describe('history', () => {
  it('keeps a claim picture and where its time came from', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const claims = createClaimHistory({ db })
    const base = {
      campaignId: 'c',
      gameName: 'Rust',
      dropName: 'Hoodie',
      rewards: ['Hoodie'],
      claimedAt: new Date('2026-11-01T10:00:00Z')
    }
    claims.record({ ...base, dropId: 'a' })
    claims.record({ ...base, dropId: 'b', imageUrl: 'https://x/y.png', source: 'twitch' })
    const [b, a] = claims.recent(5).sort((x, y) => y.dropId.localeCompare(x.dropId))
    expect(a).toEqual({ ...base, dropId: 'a' })
    expect(b).toEqual({ ...base, dropId: 'b', imageUrl: 'https://x/y.png', source: 'twitch' })
    db.close()
  })

  it('saves how each campaign stood when last seen', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const seen = createSeenCampaigns({ db })
    const at = new Date('2026-11-01T10:00:00Z')
    seen.record(
      [
        { id: 'a', name: 'A', gameId: 'g', gameName: 'Rust' },
        { id: 'b', name: 'B', gameId: 'g', gameName: 'Rust' }
      ],
      at
    )
    const standing = {
      startsAt: new Date('2026-10-30T00:00:00Z'),
      endsAt: new Date('2026-11-06T00:00:00Z'),
      dropsTotal: 3,
      dropsClaimed: 1,
      earnable: true
    }
    seen.updateStandings([{ id: 'a', ...standing }], at)
    const [a, b] = seen.all()
    expect(a).toEqual({
      id: 'a',
      name: 'A',
      gameId: 'g',
      gameName: 'Rust',
      firstSeenAt: at,
      standing: { ...standing, lastSeenAt: at }
    })
    expect(b?.standing).toBeUndefined()
    db.close()
  })

  it('joins watched minutes into sessions', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const log = createWatchLog({ db })
    const minute = 60_000
    const t0 = Date.parse('2026-11-01T10:00:00Z')
    const rust = { channelLogin: 'x', channelName: 'X', gameName: 'Rust', campaignId: 'c1' }
    expect(log.firstAt()).toBeUndefined()
    log.count(rust, new Date(t0 + minute), minute, 3 * minute)
    log.count(rust, new Date(t0 + 2 * minute), minute, 3 * minute)
    log.count(rust, new Date(t0 + 3 * minute), minute, 3 * minute)
    // Another campaign on the same channel starts a session; so does a long gap.
    log.count({ ...rust, campaignId: 'c2' }, new Date(t0 + 4 * minute), minute, 3 * minute)
    log.count({ ...rust, campaignId: 'c2' }, new Date(t0 + 30 * minute), minute, 3 * minute)
    const sessions = log.since(new Date(t0))
    expect(
      sessions.map((s) => [s.campaignId, s.startedAt.getTime() - t0, s.endedAt.getTime() - t0])
    ).toEqual([
      ['c2', 29 * minute, 30 * minute],
      ['c2', 3 * minute, 4 * minute],
      ['c1', 0, 3 * minute]
    ])
    expect(log.firstAt()).toEqual(new Date(t0))
    expect(log.since(new Date(t0 + 10 * minute))).toHaveLength(1)
    db.close()
  })

  it('keeps events in order, and finds the latest of a kind', () => {
    const db = openSqlite(':memory:')
    runMigrations(db)
    const events = createEventLog({ db })
    expect(events.latest('version')).toBeUndefined()
    events.record('version', { version: '1.0.0' }, new Date('2026-11-01T00:00:00Z'))
    events.record('list', { game: 'Rust', list: 'priority' }, new Date('2026-11-02T00:00:00Z'))
    events.record('version', { version: '1.1.0' }, new Date('2026-11-03T00:00:00Z'))
    expect(events.all().map((e) => e.kind)).toEqual(['version', 'list', 'version'])
    expect(events.latest('version')?.data).toEqual({ version: '1.1.0' })
    db.close()
  })
})
