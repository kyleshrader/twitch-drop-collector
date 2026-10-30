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

/** Worth leaving `watching` for `candidate`: a strictly better game, or same game but ACL-based. */
export function shouldSwitch(
  candidate: Channel,
  watching: Channel | undefined,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext
): boolean {
  if (!canWatch(candidate, campaigns, wanted, ctx)) return false
  if (!watching || !canWatch(watching, campaigns, wanted, ctx)) return true
  const candidateRank = gamePriority(candidate, wanted)
  const watchingRank = gamePriority(watching, wanted)
  return (
    candidateRank < watchingRank ||
    (candidateRank === watchingRank && candidate.aclBased && !watching.aclBased)
  )
}

/** Game priority first, then allowed-list channels, then most viewers. */
export function rankChannels(channels: readonly Channel[], wanted: readonly Game[]): Channel[] {
  return [...channels].sort(
    (a, b) =>
      gamePriority(a, wanted) - gamePriority(b, wanted) ||
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
}): { channel?: Channel; reason: PickReason } {
  const { channels, watching, selected, campaigns, wanted, ctx } = input
  if (selected && canWatch(selected, campaigns, wanted, ctx)) {
    return { channel: selected, reason: 'selected' }
  }
  const better = rankChannels(channels, wanted).find((c) =>
    shouldSwitch(c, watching, campaigns, wanted, ctx)
  )
  if (better) return { channel: better, reason: 'better' }
  if (watching && canWatch(watching, campaigns, wanted, ctx)) {
    return { channel: watching, reason: 'stay' }
  }
  return { reason: 'none' }
}

/** The campaign being progressed on `channel`: the earnable one closest to completion. */
export function activeCampaign(
  channel: Channel,
  campaigns: readonly Campaign[],
  wanted: readonly Game[],
  ctx: EarnContext
): Campaign | undefined {
  if (wanted.length === 0) return undefined
  return campaigns
    .filter((c) => canEarnCampaign(c, ctx, channel))
    .sort((a, b) => campaignRemainingMinutes(a) - campaignRemainingMinutes(b))[0]
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
