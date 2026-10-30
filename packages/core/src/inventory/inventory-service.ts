// The user's campaigns: fetched from Twitch, kept up to date with progress, and claimed.
import { gql, GqlError, type GqlClient } from '@tdc/api'
import { createEmitter, type Clock, type Logger } from '@tdc/kernel'
import type { ClaimHistory } from '@tdc/storage'
import {
  applyDropMinutes,
  bumpEstimatedMinutes,
  canClaimDrop,
  isUpcoming,
  markClaimed,
  setClaimId,
  type EarnContext
} from '../domain/rules'
import type { Campaign, Channel, Drop } from '../domain/types'
import { buildCampaigns } from './mapping'

/** Twitch's answers to a claim that mean "it's yours". */
const CLAIM_OK = new Set(['ELIGIBLE_FOR_ALL', 'DROP_INSTANCE_ALREADY_CLAIMED'])

export interface InventoryService {
  campaigns(): readonly Campaign[]
  find(dropId: string): { campaign: Campaign; drop: Drop } | undefined
  /** Fetches inventory, the campaign list and details, and rebuilds the campaigns. */
  refresh(signal?: AbortSignal): Promise<readonly Campaign[]>
  /** Twitch reported progress for a drop. Returns the updated campaign. */
  updateDropMinutes(dropId: string, minutes: number): Campaign | undefined
  /** One estimated minute on the active campaign while Twitch isn't reporting progress. */
  bumpEstimatedMinutes(
    campaignId: string,
    ctx: EarnContext,
    channel: Channel
  ): { reachedCap: boolean }
  setClaimId(dropId: string, claimId: string): void
  /** Claims one drop. True when Twitch confirms (or it was already claimed). */
  claim(dropId: string, signal?: AbortSignal): Promise<boolean>
  /** Claims every claimable drop in active and expired campaigns. Returns the drops claimed. */
  claimAll(signal?: AbortSignal): Promise<Drop[]>
  onChange(listener: (campaigns: readonly Campaign[]) => void): () => void
}

export function createInventoryService(deps: {
  gql: GqlClient
  /** The signed-in user's ID; campaign details are keyed by it. */
  userId: () => string
  claims: Pick<ClaimHistory, 'record'>
  clock: Clock
  logger: Logger
}): InventoryService {
  const { gql: client, userId, claims, clock, logger } = deps
  const events = createEmitter<{ change: readonly Campaign[] }>({
    onListenerError: (error) => logger.error('Inventory listener failed', { error })
  })
  let campaigns: readonly Campaign[] = []

  const publish = (next: readonly Campaign[]): void => {
    campaigns = next
    events.emit('change', next)
  }
  const replace = (updated: Campaign): void =>
    publish(campaigns.map((c) => (c.id === updated.id ? updated : c)))

  const find = (dropId: string): { campaign: Campaign; drop: Drop } | undefined => {
    for (const campaign of campaigns) {
      const drop = campaign.drops.find((d) => d.id === dropId)
      if (drop) return { campaign, drop }
    }
    return undefined
  }

  const claim = async (dropId: string, signal?: AbortSignal): Promise<boolean> => {
    const found = find(dropId)
    if (!found) return false
    const { campaign, drop } = found
    if (drop.claimed) return true
    if (!drop.claimId || !canClaimDrop(drop, campaign, clock.now())) return false
    try {
      const result = await client.request(gql.ClaimDrop, { dropInstanceId: drop.claimId }, signal)
      const status = result.claimDropRewards?.status
      if (!status || !CLAIM_OK.has(status)) {
        logger.warn('Twitch did not confirm a claim', { dropId, status })
        return false
      }
    } catch (error) {
      if (!(error instanceof GqlError)) throw error
      logger.warn('Claim failed', { dropId, error: error.message })
      return false
    }
    replace(markClaimed(campaign, dropId))
    claims.record({
      dropId,
      campaignId: campaign.id,
      gameName: campaign.game.name,
      dropName: drop.name,
      rewards: drop.benefits.map((b) => b.name),
      claimedAt: clock.now()
    })
    logger.info('Claimed a drop', { game: campaign.game.name, drop: drop.name })
    return true
  }

  return {
    campaigns: () => campaigns,
    find,

    async refresh(signal) {
      const inventory = (await client.request(gql.Inventory, undefined, signal)).currentUser
        .inventory
      const list = (await client.request(gql.Campaigns, undefined, signal)).currentUser
        .dropCampaigns
      if (list === null || list === undefined) {
        // Only Android app sessions get the campaign list (docs/decisions.md).
        logger.warn('Twitch returned no campaign list; only in-progress campaigns are known')
      }
      const current = (list ?? []).filter((c) => c.status === 'ACTIVE' || c.status === 'UPCOMING')
      const details = await client.batch(
        gql.CampaignDetailsQuery,
        current.map((c) => ({ campaignId: c.id, userId: userId() })),
        signal
      )
      const { campaigns: built, problems } = buildCampaigns({
        inProgress: inventory.dropCampaignsInProgress ?? [],
        claimedRewards: inventory.gameEventDrops ?? [],
        campaignList: current,
        details: details
          .map((d) => d.user?.dropCampaign)
          .filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined)
      })
      for (const problem of problems) logger.warn('Skipped a campaign', { problem })
      publish(built)
      return built
    },

    updateDropMinutes(dropId, minutes) {
      const found = find(dropId)
      if (!found) return undefined
      const updated = applyDropMinutes(found.campaign, dropId, minutes)
      replace(updated)
      return updated
    },

    bumpEstimatedMinutes(campaignId, ctx, channel) {
      const campaign = campaigns.find((c) => c.id === campaignId)
      if (!campaign) return { reachedCap: false }
      const result = bumpEstimatedMinutes(campaign, ctx, channel)
      replace(result.campaign)
      return { reachedCap: result.reachedCap }
    },

    setClaimId(dropId, claimId) {
      const found = find(dropId)
      if (found) replace(setClaimId(found.campaign, dropId, claimId))
    },

    claim,

    async claimAll(signal) {
      const claimed: Drop[] = []
      const now = clock.now()
      const candidates = campaigns
        .filter((c) => !isUpcoming(c, now))
        .flatMap((c) => c.drops.filter((d) => canClaimDrop(d, c, now)))
      for (const drop of candidates) {
        if (await claim(drop.id, signal)) claimed.push(drop)
      }
      return claimed
    },

    onChange: (listener) => events.on('change', listener)
  }
}
