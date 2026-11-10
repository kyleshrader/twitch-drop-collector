// History of claimed drops: the ones this app claimed, and ones Twitch's inventory says were
// claimed (with Twitch's award time), so the History page keeps them after the campaign is gone.
import type { Database, Row } from './database'

export interface ClaimRecord {
  dropId: string
  campaignId: string
  gameName: string
  dropName: string
  rewards: string[]
  claimedAt: Date
  /** The first reward's picture. */
  imageUrl?: string
  /** Who knew the time: this app when it claimed (the default), or Twitch's award time. */
  source?: 'app' | 'twitch'
}

export interface ClaimHistory {
  /** Records a claim. Returns false if this drop was already recorded. */
  record(claim: ClaimRecord): boolean
  has(dropId: string): boolean
  /** Most recent first. */
  recent(limit: number): ClaimRecord[]
  /** When each recorded drop was claimed, by drop ID. */
  claimTimes(): Map<string, Date>
}

function toRecord(row: Row): ClaimRecord {
  const rewards: unknown = JSON.parse(String(row['rewards']))
  return {
    dropId: String(row['drop_id']),
    campaignId: String(row['campaign_id']),
    gameName: String(row['game_name']),
    dropName: String(row['drop_name']),
    rewards: Array.isArray(rewards) ? rewards.map(String) : [],
    claimedAt: new Date(Number(row['claimed_at'])),
    ...(row['image_url'] ? { imageUrl: String(row['image_url']) } : {}),
    ...(row['source'] === 'twitch' ? { source: 'twitch' as const } : {})
  }
}

export function createClaimHistory(deps: { db: Database }): ClaimHistory {
  const { db } = deps
  return {
    record(claim): boolean {
      const { changes } = db.run(
        `INSERT INTO claims
           (drop_id, campaign_id, game_name, drop_name, rewards, claimed_at, image_url, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (drop_id) DO NOTHING`,
        claim.dropId,
        claim.campaignId,
        claim.gameName,
        claim.dropName,
        JSON.stringify(claim.rewards),
        claim.claimedAt.getTime(),
        claim.imageUrl ?? null,
        claim.source ?? 'app'
      )
      return changes > 0
    },
    has(dropId): boolean {
      return db.get('SELECT 1 AS found FROM claims WHERE drop_id = ?', dropId) !== undefined
    },
    claimTimes(): Map<string, Date> {
      return new Map(
        db
          .all('SELECT drop_id, claimed_at FROM claims')
          .map((row) => [String(row['drop_id']), new Date(Number(row['claimed_at']))])
      )
    },
    recent(limit): ClaimRecord[] {
      return db
        .all('SELECT * FROM claims ORDER BY claimed_at DESC, drop_id LIMIT ?', Math.max(0, limit))
        .map(toRecord)
    }
  }
}
