// History of drops this app has claimed, for the inventory screen and to avoid double claims.
import type { Database, Row } from './database'

export interface ClaimRecord {
  dropId: string
  campaignId: string
  gameName: string
  dropName: string
  rewards: string[]
  claimedAt: Date
}

export interface ClaimHistory {
  /** Records a claim. Returns false if this drop was already recorded. */
  record(claim: ClaimRecord): boolean
  has(dropId: string): boolean
  /** Most recent first. */
  recent(limit: number): ClaimRecord[]
}

function toRecord(row: Row): ClaimRecord {
  const rewards: unknown = JSON.parse(String(row['rewards']))
  return {
    dropId: String(row['drop_id']),
    campaignId: String(row['campaign_id']),
    gameName: String(row['game_name']),
    dropName: String(row['drop_name']),
    rewards: Array.isArray(rewards) ? rewards.map(String) : [],
    claimedAt: new Date(Number(row['claimed_at']))
  }
}

export function createClaimHistory(deps: { db: Database }): ClaimHistory {
  const { db } = deps
  return {
    record(claim): boolean {
      const { changes } = db.run(
        `INSERT INTO claims (drop_id, campaign_id, game_name, drop_name, rewards, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (drop_id) DO NOTHING`,
        claim.dropId,
        claim.campaignId,
        claim.gameName,
        claim.dropName,
        JSON.stringify(claim.rewards),
        claim.claimedAt.getTime()
      )
      return changes > 0
    },
    has(dropId): boolean {
      return db.get('SELECT 1 AS found FROM claims WHERE drop_id = ?', dropId) !== undefined
    },
    recent(limit): ClaimRecord[] {
      return db
        .all('SELECT * FROM claims ORDER BY claimed_at DESC, drop_id LIMIT ?', Math.max(0, limit))
        .map(toRecord)
    }
  }
}
