// What was watched, and for how long: the History page's watch sessions. The miner's runtime
// counts a minute at a time; minutes on the same channel, game and campaign join one session
// while they follow on from each other.
import type { Database, Row } from './database'

export interface WatchedChannel {
  channelLogin: string
  channelName: string
  gameName: string
  campaignId?: string
  campaignName?: string
}

export interface WatchSession extends WatchedChannel {
  id: number
  startedAt: Date
  endedAt: Date
}

export interface WatchLog {
  /**
   * Counts the `spanMs` of watching that ended `at`. It joins the latest session when that's the
   * same channel, game and campaign and ended no more than `joinMs` earlier; else a new one
   * starts `spanMs` before `at`.
   */
  count(watched: WatchedChannel, at: Date, spanMs: number, joinMs: number): void
  /** Sessions that ended at or after `from`, newest first. */
  since(from: Date): WatchSession[]
  /** The earliest session's start, if any. */
  firstAt(): Date | undefined
}

function toSession(row: Row): WatchSession {
  return {
    id: Number(row['id']),
    channelLogin: String(row['channel_login']),
    channelName: String(row['channel_name']),
    gameName: String(row['game_name']),
    ...(row['campaign_id'] ? { campaignId: String(row['campaign_id']) } : {}),
    ...(row['campaign_name'] ? { campaignName: String(row['campaign_name']) } : {}),
    startedAt: new Date(Number(row['started_at'])),
    endedAt: new Date(Number(row['ended_at']))
  }
}

export function createWatchLog(deps: { db: Database }): WatchLog {
  const { db } = deps
  return {
    count(watched, at, spanMs, joinMs): void {
      const last = db.get('SELECT * FROM watch_sessions ORDER BY ended_at DESC, id DESC LIMIT 1')
      const latest = last ? toSession(last) : undefined
      const joins =
        latest !== undefined &&
        latest.channelLogin === watched.channelLogin &&
        latest.gameName === watched.gameName &&
        (latest.campaignId ?? '') === (watched.campaignId ?? '') &&
        at.getTime() - latest.endedAt.getTime() <= joinMs &&
        at.getTime() >= latest.endedAt.getTime()
      if (joins) {
        db.run('UPDATE watch_sessions SET ended_at = ? WHERE id = ?', at.getTime(), latest.id)
        return
      }
      db.run(
        `INSERT INTO watch_sessions
           (channel_login, channel_name, game_name, campaign_id, campaign_name, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        watched.channelLogin,
        watched.channelName,
        watched.gameName,
        watched.campaignId ?? null,
        watched.campaignName ?? null,
        at.getTime() - spanMs,
        at.getTime()
      )
    },
    since(from): WatchSession[] {
      return db
        .all(
          'SELECT * FROM watch_sessions WHERE ended_at >= ? ORDER BY started_at DESC, id DESC',
          from.getTime()
        )
        .map(toSession)
    },
    firstAt(): Date | undefined {
      const row = db.get('SELECT MIN(started_at) AS first FROM watch_sessions')
      return row?.['first'] === null || row?.['first'] === undefined
        ? undefined
        : new Date(Number(row['first']))
    }
  }
}
