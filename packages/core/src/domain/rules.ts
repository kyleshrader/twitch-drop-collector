// Drop and campaign rules (docs/port-plan.md §3 "Campaigns and drops"). Pure: time is passed in.
import type { Campaign, Channel, Drop, Game, MiningPreferences } from './types'

/** Games whose campaigns can be earned on any channel, whatever it streams. */
export const SPECIAL_GAME_IDS: ReadonlySet<string> = new Set(['509663', '509672'])
/** Estimated minutes allowed while Twitch isn't reporting progress. */
export const MAX_EXTRA_MINUTES = 15
/** Twitch lets finished drops be claimed for a day after their campaign ends. */
export const CLAIM_GRACE_MS = 24 * 60 * 60 * 1000

export interface EarnContext {
  now: Date
  preferences: Pick<MiningPreferences, 'enableBadgesEmotes'>
}

export const isSpecialGame = (game: Game): boolean => SPECIAL_GAME_IDS.has(game.id)

const isValid = (c: Campaign): boolean => c.status !== 'EXPIRED'

export function isActive(c: Campaign, now: Date): boolean {
  return isValid(c) && c.startsAt <= now && now < c.endsAt
}

export function isUpcoming(c: Campaign, now: Date): boolean {
  return isValid(c) && now < c.startsAt
}

export function isExpired(c: Campaign, now: Date): boolean {
  return !isValid(c) || c.endsAt <= now
}

export function hasBadgeOrEmote(c: Campaign): boolean {
  return c.drops.some((d) => d.benefits.some((b) => b.type === 'BADGE' || b.type === 'EMOTE'))
}

/** Badge and emote campaigns follow the setting; everything else needs a linked account. */
export function isEligible(c: Campaign, preferences: EarnContext['preferences']): boolean {
  return hasBadgeOrEmote(c) ? preferences.enableBadgesEmotes : c.linked
}

const findDrop = (c: Campaign, id: string): Drop | undefined => c.drops.find((d) => d.id === id)

/** IDs of drops that unclaimed drops still wait on. */
function preconditionChain(c: Campaign): Set<string> {
  return new Set(c.drops.filter((d) => !d.claimed).flatMap((d) => d.preconditionIds))
}

/** A precondition outside the campaign can't be checked, so it doesn't block. */
const preconditionsMet = (d: Drop, c: Campaign): boolean =>
  d.preconditionIds.every((id) => findDrop(c, id)?.claimed ?? true)

function baseEarnConditions(d: Drop, c: Campaign): boolean {
  return (
    preconditionsMet(d, c) &&
    !d.claimed &&
    (d.benefits.length > 0 || preconditionChain(c).has(d.id)) &&
    d.requiredMinutes > 0 &&
    d.extraMinutes < MAX_EXTRA_MINUTES
  )
}

/** The drop itself can progress now (ignores campaign eligibility and the channel). */
export function canEarnDrop(d: Drop, c: Campaign, now: Date): boolean {
  return baseEarnConditions(d, c) && d.startsAt <= now && now < d.endsAt
}

function canEarnDropWithin(d: Drop, c: Campaign, now: Date, cutoff: Date): boolean {
  return baseEarnConditions(d, c) && d.endsAt > now && d.startsAt < cutoff
}

function campaignAllowsChannel(
  c: Campaign,
  ctx: EarnContext,
  channel: Channel | undefined,
  ignoreChannelStatus: boolean
): boolean {
  if (!isEligible(c, ctx.preferences) || !isActive(c, ctx.now)) return false
  if (!channel) return true
  if (c.allowedChannels.length > 0 && !c.allowedChannels.some((a) => a.id === channel.id)) {
    return false
  }
  return ignoreChannelStatus || channel.stream?.game?.id === c.game.id || isSpecialGame(c.game)
}

/** Watching `channel` (or anything, if omitted) would progress some drop in this campaign. */
export function canEarnCampaign(
  c: Campaign,
  ctx: EarnContext,
  channel?: Channel,
  options: { ignoreChannelStatus?: boolean } = {}
): boolean {
  return (
    campaignAllowsChannel(c, ctx, channel, options.ignoreChannelStatus ?? false) &&
    c.drops.some((d) => canEarnDrop(d, c, ctx.now))
  )
}

/** Like canEarnCampaign, but for any time before `cutoff` and without a channel. */
export function canEarnCampaignWithin(c: Campaign, ctx: EarnContext, cutoff: Date): boolean {
  return (
    isEligible(c, ctx.preferences) &&
    isValid(c) &&
    c.endsAt > ctx.now &&
    c.startsAt < cutoff &&
    c.drops.some((d) => canEarnDropWithin(d, c, ctx.now, cutoff))
  )
}

export function canClaimDrop(d: Drop, c: Campaign, now: Date): boolean {
  return (
    d.claimId !== undefined && !d.claimed && now.getTime() < c.endsAt.getTime() + CLAIM_GRACE_MS
  )
}

// ---- minutes ---------------------------------------------------------------------------------

export const currentMinutes = (d: Drop): number => d.realMinutes + d.extraMinutes
export const remainingMinutes = (d: Drop): number => d.requiredMinutes - currentMinutes(d)

/** Remaining minutes including the longest unfinished precondition chain before it. */
export function totalRemainingMinutes(
  d: Drop,
  c: Campaign,
  seen: ReadonlySet<string> = new Set()
): number {
  const visited = new Set(seen).add(d.id)
  const before = d.preconditionIds
    .filter((id) => !visited.has(id))
    .map((id) => findDrop(c, id))
    .filter((p): p is Drop => p !== undefined)
    .map((p) => totalRemainingMinutes(p, c, visited))
  return remainingMinutes(d) + Math.max(0, ...before)
}

export function dropProgress(d: Drop): number {
  if (d.requiredMinutes <= 0 || currentMinutes(d) <= 0) return 0
  return Math.min(1, currentMinutes(d) / d.requiredMinutes)
}

/** Minutes left in the drop's window per minute still needed; Infinity when nothing is needed. */
export function dropAvailability(d: Drop, c: Campaign, now: Date): number {
  const remaining = totalRemainingMinutes(d, c)
  if (d.requiredMinutes <= 0 || remaining <= 0 || now >= d.endsAt) return Number.POSITIVE_INFINITY
  return (d.endsAt.getTime() - now.getTime()) / 60_000 / remaining
}

export const campaignRemainingMinutes = (c: Campaign): number =>
  Math.max(0, ...c.drops.map((d) => totalRemainingMinutes(d, c)))

export const campaignAvailability = (c: Campaign, now: Date): number =>
  Math.min(Number.POSITIVE_INFINITY, ...c.drops.map((d) => dropAvailability(d, c, now)))

export const campaignProgress = (c: Campaign): number =>
  c.drops.length === 0 ? 0 : c.drops.reduce((sum, d) => sum + dropProgress(d), 0) / c.drops.length

export const claimedDropCount = (c: Campaign): number => c.drops.filter((d) => d.claimed).length

/** The earnable drop closest to completion. */
export function firstEarnableDrop(
  c: Campaign,
  ctx: EarnContext,
  channel?: Channel
): Drop | undefined {
  if (!campaignAllowsChannel(c, ctx, channel, false)) return undefined
  return c.drops
    .filter((d) => canEarnDrop(d, c, ctx.now))
    .sort((a, b) => remainingMinutes(a) - remainingMinutes(b))[0]
}

// ---- state changes (return new campaigns) -----------------------------------------------------

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Twitch reported `minutes` for one drop. Watching progresses every drop in the campaign at
 * once, so the same change applies to all of them; estimated minutes are replaced.
 */
export function applyDropMinutes(c: Campaign, dropId: string, minutes: number): Campaign {
  const target = findDrop(c, dropId)
  if (!target) return c
  const delta = clamp(minutes, 0, target.requiredMinutes) - target.realMinutes
  return {
    ...c,
    drops: c.drops.map((d) => ({
      ...d,
      realMinutes: clamp(d.realMinutes + delta, 0, d.requiredMinutes),
      extraMinutes: 0
    }))
  }
}

/** One estimated minute on every drop that can progress on `channel`. */
export function bumpEstimatedMinutes(
  c: Campaign,
  ctx: EarnContext,
  channel?: Channel
): { campaign: Campaign; reachedCap: boolean } {
  if (!campaignAllowsChannel(c, ctx, channel, false)) return { campaign: c, reachedCap: false }
  let reachedCap = false
  const drops = c.drops.map((d) => {
    if (!canEarnDrop(d, c, ctx.now)) return d
    const extraMinutes = d.extraMinutes + 1
    if (extraMinutes >= MAX_EXTRA_MINUTES) reachedCap = true
    return { ...d, extraMinutes }
  })
  return { campaign: { ...c, drops }, reachedCap }
}

export function markClaimed(c: Campaign, dropId: string): Campaign {
  return {
    ...c,
    drops: c.drops.map((d) =>
      d.id === dropId ? { ...d, claimed: true, realMinutes: d.requiredMinutes, extraMinutes: 0 } : d
    )
  }
}

export function setClaimId(c: Campaign, dropId: string, claimId: string): Campaign {
  return { ...c, drops: c.drops.map((d) => (d.id === dropId ? { ...d, claimId } : d)) }
}
