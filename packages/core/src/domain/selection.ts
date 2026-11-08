// Choosing what to watch (docs/port-plan.md §3 "Choosing what to watch"). Pure: time is passed in.
import {
  campaignAvailability,
  campaignRemainingMinutes,
  canEarnCampaign,
  canEarnCampaignWithin,
  isSpecialGame,
  type EarnContext
} from './rules'
import type { Campaign, Channel, Game, MiningPreferences } from './types'

/** PubSub: 8 sockets × 50 topics, minus 2 user topics, at 2 topics per channel. */
export const MAX_CHANNELS = Math.floor((8 * 50 - 2) / 2)
/** Games are wanted if a campaign for them can progress within this horizon. */
export const PLANNING_HORIZON_MS = 60 * 60 * 1000

const later = (now: Date, ms: number): Date => new Date(now.getTime() + ms)

/** Games worth mining, best first. */
export function selectWantedGames(
  campaigns: readonly Campaign[],
  preferences: MiningPreferences,
  now: Date
): Game[] {
  const { priority, exclude, priorityMode } = preferences
  const ctx: EarnContext = { now, preferences }
  const cutoff = later(now, PLANNING_HORIZON_MS)
  const rank = (c: Campaign): number => {
    const index = priority.indexOf(c.game.name)
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }

  const sorted = [...campaigns]
  if (priorityMode === 'endingSoonest') {
    sorted.sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
  } else if (priorityMode === 'lowAvailabilityFirst') {
    sorted.sort((a, b) => campaignAvailability(a, now) - campaignAvailability(b, now))
  }
  // Stable: games on the priority list come first, in list order; the rest keep the mode's order.
  sorted.sort((a, b) => rank(a) - rank(b))

  const wanted: Game[] = []
  for (const c of sorted) {
    if (wanted.some((g) => g.id === c.game.id)) continue
    if (exclude.includes(c.game.name)) continue
    if (priorityMode === 'priorityOnly' && !priority.includes(c.game.name)) continue
    if (!canEarnCampaignWithin(c, ctx, cutoff)) continue
    wanted.push(c.game)
  }
  return wanted
}

/** Lower is better; Infinity for offline channels or games we don't want. */
export function gamePriority(channel: Channel, wanted: readonly Game[]): number {
  const gameId = channel.stream?.game?.id
  const index = gameId === undefined ? -1 : wanted.findIndex((g) => g.id === gameId)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

/**
 * The Up next queue's ranking: queue position by campaign ID, lower is better. When given, it
 * replaces game priority for choosing channels and the campaign shown as progressing.
 */
export type CampaignRank = ReadonlyMap<string, number>

/** The best queue position among the campaigns watching this channel would progress. */
export function queuePriority(
  channel: Channel,
  campaigns: readonly Campaign[],
  rank: CampaignRank,
  ctx: EarnContext
): number {
  let best = Number.POSITIVE_INFINITY
  for (const c of campaigns) {
    const position = rank.get(c.id)
    if (position !== undefined && position < best && canEarnCampaign(c, ctx, channel)) {
      best = position
    }
  }
  return best
}

/** Wanted games reordered by their best queue position (games the queue doesn't rank go last). */
export function orderWantedByQueue(
  wanted: readonly Game[],
  campaigns: readonly Campaign[],
  rank: CampaignRank
): Game[] {
  const best = (g: Game): number =>
    Math.min(
      Number.POSITIVE_INFINITY,
      ...campaigns.filter((c) => c.game.id === g.id).map((c) => rank.get(c.id) ?? Infinity)
    )
  return [...wanted].sort((a, b) => best(a) - best(b))
}

/** Watching this channel would progress a drop the user wants. */
export function canWatch(
  channel: Channel,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext
): boolean {
  const live = channel.stream
  if (!live) return false
  return campaigns.some(
    (c) =>
      canEarnCampaign(c, ctx, channel) &&
      ((live.game !== undefined &&
        live.dropsEnabled &&
        wanted.some((g) => g.id === live.game?.id)) ||
        isSpecialGame(c.game))
  )
}

/** Why watching a channel wouldn't progress anything: the first reason that applies. */
export type WatchBlocker = 'offline' | 'dropsOff' | 'otherGame' | 'nothingToEarn'

/** Undefined when `canWatch`; otherwise why not, for the channel list and manual picks. */
export function watchBlocker(
  channel: Channel,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext
): WatchBlocker | undefined {
  if (canWatch(channel, campaigns, wanted, ctx)) return undefined
  const live = channel.stream
  if (!live) return 'offline'
  if (!live.dropsEnabled) return 'dropsOff'
  if (!live.game || !wanted.some((g) => g.id === live.game?.id)) return 'otherGame'
  return 'nothingToEarn'
}

/** Worth leaving `watching` for `candidate`: a strictly better game, or same game but ACL-based. */
export function shouldSwitch(
  candidate: Channel,
  watching: Channel | undefined,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext,
  rank?: CampaignRank
): boolean {
  if (!canWatch(candidate, campaigns, wanted, ctx)) return false
  if (!watching || !canWatch(watching, campaigns, wanted, ctx)) return true
  const priority = (c: Channel): number =>
    rank ? queuePriority(c, campaigns, rank, ctx) : gamePriority(c, wanted)
  const candidateRank = priority(candidate)
  const watchingRank = priority(watching)
  return (
    candidateRank < watchingRank ||
    (candidateRank === watchingRank && candidate.aclBased && !watching.aclBased)
  )
}

/** Game priority (or `priority`) first, then allowed-list channels, then most viewers. */
export function rankChannels(
  channels: readonly Channel[],
  wanted: readonly Game[],
  priority: (c: Channel) => number = (c) => gamePriority(c, wanted)
): Channel[] {
  return [...channels].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      Number(b.aclBased) - Number(a.aclBased) ||
      (b.stream?.viewers ?? -1) - (a.stream?.viewers ?? -1)
  )
}

/** Trims a ranked list to what PubSub can follow. */
export const capChannels = (ranked: readonly Channel[]): Channel[] => ranked.slice(0, MAX_CHANNELS)

export type PickReason = 'selected' | 'better' | 'stay' | 'none'

export function pickChannel(input: {
  channels: readonly Channel[]
  watching?: Channel
  selected?: Channel
  campaigns: readonly Campaign[]
  wanted: readonly Game[]
  ctx: EarnContext
  rank?: CampaignRank
}): { channel?: Channel; reason: PickReason } {
  const { channels, watching, selected, campaigns, wanted, ctx, rank } = input
  if (selected && canWatch(selected, campaigns, wanted, ctx)) {
    return { channel: selected, reason: 'selected' }
  }
  const priority = rank ? (c: Channel) => queuePriority(c, campaigns, rank, ctx) : undefined
  const better = rankChannels(channels, wanted, priority).find((c) =>
    shouldSwitch(c, watching, campaigns, wanted, ctx, rank)
  )
  if (better) return { channel: better, reason: 'better' }
  if (watching && canWatch(watching, campaigns, wanted, ctx)) {
    return { channel: watching, reason: 'stay' }
  }
  return { reason: 'none' }
}

/**
 * The campaign being progressed on `channel`: the earnable one closest to completion, or the
 * one ranked highest in the queue when a ranking is given.
 */
export function activeCampaign(
  channel: Channel,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext,
  rank?: CampaignRank
): Campaign | undefined {
  if (wanted.length === 0) return undefined
  const position = (c: Campaign): number => rank?.get(c.id) ?? Number.POSITIVE_INFINITY
  return campaigns
    .filter((c) => canEarnCampaign(c, ctx, channel))
    .sort(
      (a, b) =>
        (rank ? position(a) - position(b) : 0) ||
        campaignRemainingMinutes(a) - campaignRemainingMinutes(b)
    )[0]
}

/** When campaigns or drops start or end within the next hour: times to re-check channels. */
export function maintenanceTriggers(campaigns: readonly Campaign[], ctx: EarnContext): Date[] {
  const cutoff = later(ctx.now, PLANNING_HORIZON_MS)
  const times = new Set<number>()
  for (const c of campaigns) {
    if (!canEarnCampaignWithin(c, ctx, cutoff)) continue
    for (const t of [c.startsAt, c.endsAt, ...c.drops.flatMap((d) => [d.startsAt, d.endsAt])]) {
      if (t > ctx.now && t <= cutoff) times.add(t.getTime())
    }
  }
  return [...times].sort((a, b) => a - b).map((t) => new Date(t))
}
