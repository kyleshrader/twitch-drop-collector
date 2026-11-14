// The last full copy of each campaign the app has seen (as the app shows it: name, picture,
// dates, channels, every drop with its rewards and progress), so a campaign Twitch stops listing
// can still be shown. The data is the app's own JSON; storage keeps it as text and doesn't read it.
import type { Database } from './database'

export interface CampaignSnapshot {
  id: string
  gameId: string
  /** The campaign, as JSON. */
  data: string
  savedAt: Date
}

export interface CampaignSnapshots {
  /** Saves (or replaces) each campaign's copy, as of `at`. */
  save(campaigns: readonly Omit<CampaignSnapshot, 'savedAt'>[], at: Date): void
  all(): CampaignSnapshot[]
}

export function createCampaignSnapshots(deps: { db: Database }): CampaignSnapshots {
  const { db } = deps
  return {
    save(campaigns, at): void {
      db.transaction(() => {
        for (const c of campaigns) {
          db.run(
            `INSERT INTO campaign_snapshots (campaign_id, game_id, data, saved_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (campaign_id) DO UPDATE SET
               game_id = excluded.game_id, data = excluded.data, saved_at = excluded.saved_at`,
            c.id,
            c.gameId,
            c.data,
            at.getTime()
          )
        }
      })
    },
    all(): CampaignSnapshot[] {
      return db.all('SELECT * FROM campaign_snapshots ORDER BY saved_at DESC').map((row) => ({
        id: String(row['campaign_id']),
        gameId: String(row['game_id']),
        data: String(row['data']),
        savedAt: new Date(Number(row['saved_at']))
      }))
    }
  }
}
