// When each campaign was first seen: the start of the app's own history, for "recently seen"
// sorting and for counting every campaign a game has had, including ones Twitch no longer lists.
import type { Database } from './database'

export interface SeenCampaign {
  id: string
  gameId: string
  gameName: string
  name: string
}

/** How a campaign stood when last seen: enough to tell, once it ends, how it went. */
export interface CampaignStanding {
  id: string
  startsAt: Date
  endsAt: Date
  dropsTotal: number
  dropsClaimed: number
  /** The account could earn it (linked, or a badge or emote campaign with those on). */
  earnable: boolean
}

export interface SeenRecord extends SeenCampaign {
  firstSeenAt: Date
  /** Unknown for campaigns last seen before the app kept standings. */
  standing?: Omit<CampaignStanding, 'id'> & { lastSeenAt: Date }
}

export interface SeenCampaigns {
  /** Records campaigns not seen before, as first seen `at`. Returns how many were new. */
  record(campaigns: readonly SeenCampaign[], at: Date): number
  /** First-seen time by campaign ID. */
  firstSeen(): Map<string, Date>
  /** How many campaigns have been seen, by game ID. */
  countByGame(): Map<string, number>
  /** Saves how campaigns (already recorded) stand now, as seen `at`. */
  updateStandings(standings: readonly CampaignStanding[], at: Date): void
  /** Every campaign seen, with its standing when known. */
  all(): SeenRecord[]
}

const dateOf = (value: unknown): Date | undefined =>
  value === null || value === undefined ? undefined : new Date(Number(value))

export function createSeenCampaigns(deps: { db: Database }): SeenCampaigns {
  const { db } = deps
  return {
    record(campaigns, at): number {
      let added = 0
      db.transaction(() => {
        for (const c of campaigns) {
          added += db.run(
            `INSERT INTO campaigns_seen (campaign_id, game_id, game_name, campaign_name, first_seen_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (campaign_id) DO NOTHING`,
            c.id,
            c.gameId,
            c.gameName,
            c.name,
            at.getTime()
          ).changes
        }
      })
      return added
    },
    firstSeen(): Map<string, Date> {
      return new Map(
        db
          .all('SELECT campaign_id, first_seen_at FROM campaigns_seen')
          .map((row) => [String(row['campaign_id']), new Date(Number(row['first_seen_at']))])
      )
    },
    updateStandings(standings, at): void {
      db.transaction(() => {
        for (const s of standings) {
          db.run(
            `UPDATE campaigns_seen
             SET starts_at = ?, ends_at = ?, drops_total = ?, drops_claimed = ?, earnable = ?,
                 last_seen_at = ?
             WHERE campaign_id = ?`,
            s.startsAt.getTime(),
            s.endsAt.getTime(),
            s.dropsTotal,
            s.dropsClaimed,
            s.earnable ? 1 : 0,
            at.getTime(),
            s.id
          )
        }
      })
    },
    all(): SeenRecord[] {
      return db
        .all('SELECT * FROM campaigns_seen ORDER BY first_seen_at, campaign_id')
        .map((row) => {
          const startsAt = dateOf(row['starts_at'])
          const endsAt = dateOf(row['ends_at'])
          const lastSeenAt = dateOf(row['last_seen_at'])
          return {
            id: String(row['campaign_id']),
            gameId: String(row['game_id']),
            gameName: String(row['game_name']),
            name: String(row['campaign_name']),
            firstSeenAt: new Date(Number(row['first_seen_at'])),
            ...(startsAt && endsAt && lastSeenAt
              ? {
                  standing: {
                    startsAt,
                    endsAt,
                    lastSeenAt,
                    dropsTotal: Number(row['drops_total'] ?? 0),
                    dropsClaimed: Number(row['drops_claimed'] ?? 0),
                    earnable: Number(row['earnable'] ?? 0) === 1
                  }
                }
              : {})
          }
        })
    },
    countByGame(): Map<string, number> {
      return new Map(
        db
          .all('SELECT game_id, COUNT(*) AS seen FROM campaigns_seen GROUP BY game_id')
          .map((row) => [String(row['game_id']), Number(row['seen'])])
      )
    }
  }
}
