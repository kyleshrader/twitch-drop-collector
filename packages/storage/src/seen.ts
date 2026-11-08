// When each campaign was first seen: the start of the app's own history, for "recently seen"
// sorting and for counting every campaign a game has had, including ones Twitch no longer lists.
import type { Database } from './database'

export interface SeenCampaign {
  id: string
  gameId: string
  gameName: string
  name: string
}

export interface SeenCampaigns {
  /** Records campaigns not seen before, as first seen `at`. Returns how many were new. */
  record(campaigns: readonly SeenCampaign[], at: Date): number
  /** First-seen time by campaign ID. */
  firstSeen(): Map<string, Date>
  /** How many campaigns have been seen, by game ID. */
  countByGame(): Map<string, number>
}

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
    countByGame(): Map<string, number> {
      return new Map(
        db
          .all('SELECT game_id, COUNT(*) AS seen FROM campaigns_seen GROUP BY game_id')
          .map((row) => [String(row['game_id']), Number(row['seen'])])
      )
    }
  }
}
