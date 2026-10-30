// Twitch's GQL responses → the domain model. A campaign's data comes from up to three places,
// merged as upstream does, each layer winning over the one below:
//   inventory entry (your progress and claim IDs)
//   > campaign-list entry (box art, account-link state)
//   > campaign details (drops, benefits, allow-list)
// The merged object is validated as a whole, then converted.
import { gql } from '@tdc/api'
import type { z } from 'zod'
import type { BenefitType, Campaign, CampaignStatus, Drop } from '../domain/types'

type RawCampaign = z.infer<typeof gql.CampaignDetails>
type RawDrop = RawCampaign['timeBasedDrops'][number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Deep merge of two raw objects; `primary` wins, except that nested objects merge. */
export function mergeRaw(primary: unknown, secondary: unknown): unknown {
  if (!isRecord(primary) || !isRecord(secondary)) return primary ?? secondary
  const merged: Record<string, unknown> = { ...secondary }
  for (const [key, value] of Object.entries(primary)) {
    merged[key] = key in secondary ? mergeRaw(value, secondary[key]) : value
  }
  return merged
}

/** Twitch box art URLs carry a size (`…-285x380.jpg`); without it we get the original. */
export const withoutImageSize = (url: string): string => url.replace(/-\d+x\d+(?=\.\w+$)/, '')

const BENEFIT_TYPES: ReadonlySet<string> = new Set(['BADGE', 'EMOTE', 'DIRECT_ENTITLEMENT'])

function toStatus(status: string): CampaignStatus {
  return status === 'EXPIRED' || status === 'UPCOMING' ? status : 'ACTIVE'
}

function toDrop(raw: RawDrop, claimedRewards: ReadonlyMap<string, Date>): Drop {
  const startsAt = new Date(raw.startAt)
  const endsAt = new Date(raw.endAt)
  const benefits = (raw.benefitEdges ?? []).map(({ benefit }) => ({
    id: benefit.id,
    name: benefit.name,
    type: (BENEFIT_TYPES.has(benefit.distributionType)
      ? benefit.distributionType
      : 'UNKNOWN') as BenefitType,
    imageUrl: benefit.imageAssetURL
  }))
  // Without progress data, a drop counts as claimed when its rewards were awarded during it.
  const awarded = benefits
    .map((b) => claimedRewards.get(b.id))
    .filter((at): at is Date => at !== undefined)
  const claimed = raw.self
    ? raw.self.isClaimed
    : awarded.length > 0 && awarded.every((at) => startsAt <= at && at < endsAt)
  const requiredMinutes = raw.requiredMinutesWatched
  return {
    id: raw.id,
    name: raw.name,
    startsAt,
    endsAt,
    requiredMinutes,
    // Claimed drops can report odd progress; treat them as complete.
    realMinutes: claimed ? requiredMinutes : (raw.self?.currentMinutesWatched ?? 0),
    extraMinutes: 0,
    ...(raw.self?.dropInstanceID ? { claimId: raw.self.dropInstanceID } : {}),
    claimed,
    preconditionIds: (raw.preconditionDrops ?? []).map((p) => p.id),
    benefits
  }
}

function toCampaign(
  raw: RawCampaign,
  claimedRewards: ReadonlyMap<string, Date>
): Campaign | undefined {
  if (!raw.game) return undefined
  const allow = raw.allow
  const channels = allow && allow.isEnabled !== false ? (allow.channels ?? []) : []
  return {
    id: raw.id,
    name: raw.name,
    game: {
      id: raw.game.id,
      name: raw.game.displayName ?? raw.game.name ?? raw.game.id,
      ...(raw.game.slug ? { slug: raw.game.slug } : {}),
      ...(raw.game.boxArtURL ? { boxArtUrl: withoutImageSize(raw.game.boxArtURL) } : {})
    },
    status: toStatus(raw.status),
    startsAt: new Date(raw.startAt),
    endsAt: new Date(raw.endAt),
    linked: raw.self.isAccountConnected,
    ...(raw.accountLinkURL ? { linkUrl: raw.accountLinkURL } : {}),
    ...(raw.game.boxArtURL ? { imageUrl: withoutImageSize(raw.game.boxArtURL) } : {}),
    allowedChannels: channels.map((c) => ({
      id: c.id,
      login: c.name,
      ...(c.displayName ? { displayName: c.displayName } : {})
    })),
    drops: raw.timeBasedDrops.map((d) => toDrop(d, claimedRewards))
  }
}

export interface CampaignSources {
  /** Inventory → dropCampaignsInProgress. */
  inProgress: readonly unknown[]
  /** Inventory → gameEventDrops (rewards already awarded). */
  claimedRewards: readonly { id: string; lastAwardedAt: string }[]
  /** Campaign-list entries (ViewerDropsDashboard). */
  campaignList: readonly unknown[]
  /** Campaign details, already unwrapped and non-null. */
  details: readonly unknown[]
}

const idOf = (raw: unknown): string | undefined =>
  isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : undefined

/**
 * Every campaign that has details or is in progress. Campaigns without a game are skipped (as
 * upstream); campaigns that don't validate are skipped and reported in `problems`.
 */
export function buildCampaigns(sources: CampaignSources): {
  campaigns: Campaign[]
  problems: string[]
} {
  const byId = <T>(items: readonly T[]): Map<string, T> =>
    new Map(items.flatMap((item) => (idOf(item) ? [[idOf(item)!, item] as const] : [])))
  const inProgress = byId(sources.inProgress)
  const list = byId(sources.campaignList)
  const details = byId(sources.details)
  const claimedRewards = new Map(
    sources.claimedRewards.map((r) => [r.id, new Date(r.lastAwardedAt)])
  )

  const campaigns: Campaign[] = []
  const problems: string[] = []
  for (const id of new Set([...inProgress.keys(), ...details.keys()])) {
    const merged = mergeRaw(inProgress.get(id), mergeRaw(list.get(id), details.get(id)))
    const parsed = gql.CampaignDetails.safeParse(merged)
    if (!parsed.success) {
      problems.push(
        `campaign ${id}: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      )
      continue
    }
    const campaign = toCampaign(parsed.data, claimedRewards)
    if (campaign) campaigns.push(campaign)
  }
  return { campaigns, problems }
}
