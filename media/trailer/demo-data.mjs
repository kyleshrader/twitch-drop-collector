// Builds the trailer's user data folder from a real one: a consistent copy of the database with
// the cache and image index cleared (they can hold account details), watch sessions and events
// made from the real claims (the app only started recording those recently), and settings with
// just the game lists. Never copies session.bin or anything else from the folder.
//
//   node media/trailer/demo-data.mjs <tdc.db> <settings.json> [out folder]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const [source, settingsFile, outArg] = process.argv.slice(2)
if (!source || !settingsFile) {
  console.error('usage: node media/trailer/demo-data.mjs <tdc.db> <settings.json> [out folder]')
  process.exit(1)
}
const here = fileURLToPath(new URL('.', import.meta.url))
const out = outArg ?? join(here, 'out', 'userdata')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// A consistent copy, WAL included, without touching the original.
const target = join(out, 'tdc.db')
const original = new DatabaseSync(source, { readOnly: true })
original.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
original.close()

const db = new DatabaseSync(target)
db.exec(
  'DELETE FROM cache_entries; DELETE FROM images; DELETE FROM watch_sessions; DELETE FROM events;'
)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
// Channel names from the anonymised fixtures and well-known public channels per game; the
// sessions are illustrative (the app didn't record watching before migration 5).
const CHANNELS = [
  'VincentSMG',
  'Vinni_TV_',
  'Enardo247',
  'NightOwlPlays',
  'LofiQuest',
  'PixelHarbor'
]
const claims = db
  .prepare('SELECT game_name, campaign_id, claimed_at FROM claims ORDER BY claimed_at')
  .all()
const names = new Map(
  db
    .prepare('SELECT campaign_id, campaign_name FROM campaigns_seen')
    .all()
    .map((r) => [r.campaign_id, r.campaign_name])
)

// Claims of a game within six hours of each other are one sitting: watching starts a while
// before the first and ends at the last.
const sittings = []
for (const c of claims) {
  const last = sittings.at(-1)
  if (last && last.game === c.game_name && c.claimed_at - last.end < 6 * HOUR) {
    last.end = c.claimed_at
  } else {
    sittings.push({
      game: c.game_name,
      campaign: c.campaign_id,
      start: c.claimed_at,
      end: c.claimed_at
    })
  }
}
const insertSession = db.prepare(
  `INSERT INTO watch_sessions
     (channel_login, channel_name, game_name, campaign_id, campaign_name, started_at, ended_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
)
let n = 0
for (const s of sittings) {
  const channel = CHANNELS[n++ % CHANNELS.length]
  // Between 50 minutes and 3 hours of watching before the first claim of the sitting.
  const lead = (50 + ((n * 37) % 130)) * MINUTE
  const start = s.start - lead
  const end = s.end + 5 * MINUTE
  // Split long sittings into one-hour-ish sessions, as a channel change would.
  for (let from = start; from < end; from += 95 * MINUTE) {
    const to = Math.min(end, from + 95 * MINUTE - 4 * MINUTE)
    insertSession.run(
      channel.toLowerCase(),
      channel,
      s.game,
      s.campaign,
      names.get(s.campaign) ?? null,
      Math.round(from),
      Math.round(to)
    )
  }
}

// Events: the lists as they are now, added over the first days; one pause; two versions.
const settings = JSON.parse(readFileSync(settingsFile, 'utf8')).settings ?? {}
const priority = settings.mining?.priority ?? []
const exclude = settings.mining?.exclude ?? []
const first = db.prepare('SELECT MIN(first_seen_at) AS t FROM campaigns_seen').get().t ?? Date.now()
const insertEvent = db.prepare('INSERT INTO events (kind, at, data) VALUES (?, ?, ?)')
const event = (kind, at, data = {}) => insertEvent.run(kind, Math.round(at), JSON.stringify(data))
const version = JSON.parse(
  readFileSync(join(here, '../../apps/desktop/package.json'), 'utf8')
).version
event('version', first, { version: '0.9.0' })
priority
  .slice(0, 12)
  .forEach((game, i) => event('list', first + (i + 1) * 47 * MINUTE, { game, list: 'priority' }))
exclude
  .slice(0, 6)
  .forEach((game, i) =>
    event('list', first + 20 * HOUR + i * 13 * MINUTE, { game, list: 'excluded' })
  )
const now = Date.now()
event('paused', now - 2 * 24 * HOUR - 3 * HOUR)
event('resumed', now - 2 * 24 * HOUR - 2 * HOUR + 12 * MINUTE)
event('version', now - 26 * HOUR, { version })
db.close()

// Settings: the new UI, dark, and the real game lists; nothing else carried over.
writeFileSync(
  join(out, 'settings.json'),
  JSON.stringify(
    {
      version: 1,
      settings: {
        general: { ui: 'next', theme: 'dark', trayNotifications: false },
        mining: { priority, exclude, priorityMode: 'endingSoonest' }
      }
    },
    null,
    2
  )
)
if (existsSync(join(out, 'session.bin'))) throw new Error('session.bin must never be copied')
const count = (t) =>
  new DatabaseSync(target, { readOnly: true }).prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
console.log(
  `demo data in ${out}: ${count('claims')} claims, ${count('campaigns_seen')} campaigns, ${count('watch_sessions')} watch sessions, ${count('events')} events`
)
