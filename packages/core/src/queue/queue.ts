// The Up next queue (docs/new-ui/queue-rules.md). Pure: campaigns, settings and time go in; the
// ordered pieces, estimates and the miner's ranking come out. Nothing here is stored: a custom
// order is a list of campaign IDs, and pieces are worked out from it on every read.
import type { QueueSettings } from '@tdc/config'
import {
  campaignRemainingMinutes,
  canEarnCampaign,
  hasBadgeOrEmote,
  isActive,
  isEligible,
  remainingMinutes,
  type EarnContext
} from '../domain/rules'
import type { Campaign, Drop, Game, MiningPreferences } from '../domain/types'

/** The queue settings the queue reads (all but `paused`). */
export type QueueOptions = Omit<QueueSettings, 'paused'>

/** The queue's options from its settings (pausing is the runtime's business, not the queue's). */
export function queueOptions(settings: QueueSettings): QueueOptions {
  const { paused, ...options } = settings
  void paused
  return options
}

export type ListState = 'priority' | 'notSet' | 'excluded'
/** Why a campaign in the queue isn't mined. */
export type NotMinedReason = 'notLinked' | 'badgesOff' | 'priorityOnly'

export interface QueueEntry {
  campaign: Campaign
  /** Minutes still needed, by the dropProgress rule. */
  needMinutes: number
  /** Estimated minutes from now until it starts progressing (mined campaigns only). */
  startsInMinutes?: number
  /** Won't finish before it ends, by the estimate; savedAtTop when first place would save it. */
  warning?: { savedAtTop: boolean }
  /** In a custom order: not in the stored order yet. */
  isNew: boolean
  mined: boolean
  notMined?: NotMinedReason
  /** campaignProgress "together": earlier campaigns whose watching also progresses this one. */
  progressesWith: string[]
}

export interface QueuePiece {
  /** The first campaign's ID: stable while the piece keeps its first campaign. */
  key: string
  game: Game
  list: ListState
  /** Another piece in the queue has the same game. */
  split: boolean
  /** Holds the Collect now campaign. */
  focus: boolean
  entries: QueueEntry[]
}

export interface Queue {
  pieces: QueuePiece[]
  /** Excluded games' campaigns, one piece per game. */
  excluded: QueuePiece[]
  /** Every queued campaign in order, the current one included: what a custom order starts from. */
  order: string[]
  /** Minutes the current campaign still needs (0 without one). */
  currentNeedMinutes: number
  /** Queue position of every mined campaign (lower is better): the miner's ranking. */
  rank: ReadonlyMap<string, number>
}

const MINUTE = 60_000
const minutesUntil = (at: Date, now: Date): number => (at.getTime() - now.getTime()) / MINUTE

const openDrops = (c: Campaign, now: Date): Drop[] =>
  c.drops.filter((d) => !d.claimed && d.requiredMinutes > 0 && d.endsAt > now)

/** Minutes the campaign still needs: its longest drop chain, or every drop in turn. */
export function neededMinutes(c: Campaign, rule: QueueOptions['dropProgress'], now: Date): number {
  if (rule === 'together') return campaignRemainingMinutes(c)
  return openDrops(c, now).reduce((sum, d) => sum + Math.max(0, remainingMinutes(d)), 0)
}

/** The channels a campaign accepts, as a comparable key ('' for any channel). */
export const channelKey = (c: Campaign): string =>
  c.allowedChannels
    .map((a) => a.id)
    .sort()
    .join(',')

/** Watching one channel could progress both (either accepts any channel, or they share one). */
function shareChannel(a: Campaign, b: Campaign): boolean {
  if (a.game.id !== b.game.id) return false
  if (a.allowedChannels.length === 0 || b.allowedChannels.length === 0) return true
  return a.allowedChannels.some((x) => b.allowedChannels.some((y) => y.id === x.id))
}

function listOf(game: Game, preferences: MiningPreferences): ListState {
  if (preferences.exclude.includes(game.name)) return 'excluded'
  return preferences.priority.includes(game.name) ? 'priority' : 'notSet'
}

/** A campaign worth queueing: running, with something left to watch for. */
function isQueueable(c: Campaign, now: Date): boolean {
  return isActive(c, now) && openDrops(c, now).some((d) => remainingMinutes(d) > 0)
}

function notMinedReason(
  c: Campaign,
  ctx: EarnContext,
  preferences: MiningPreferences,
  list: ListState
): NotMinedReason | undefined {
  if (!isEligible(c, ctx.preferences)) return hasBadgeOrEmote(c) ? 'badgesOff' : 'notLinked'
  if (list === 'notSet' && preferences.priorityMode === 'priorityOnly') return 'priorityOnly'
  return undefined
}

/** What groups campaigns into one card under the layout. */
function pieceKeyOf(c: Campaign, layout: QueueOptions['layout']): string {
  if (layout === 'campaigns') return c.id
  return layout === 'channels' ? `${c.game.id}|${channelKey(c)}` : c.game.id
}

/** What must stay together under the split rule (undefined: nothing). */
function bondOf(c: Campaign, split: QueueOptions['split']): string | undefined {
  if (split === 'free') return undefined
  return split === 'never' ? c.game.id : `${c.game.id}|${channelKey(c)}`
}

/** Pulls campaigns that must stay together up to the first one's position (stable otherwise). */
export function normaliseOrder(
  order: readonly Campaign[],
  split: QueueOptions['split']
): Campaign[] {
  if (split === 'free') return [...order]
  const groups = new Map<string, Campaign[]>()
  const result: Campaign[][] = []
  for (const c of order) {
    const bond = bondOf(c, split)!
    const group = groups.get(bond)
    if (group) {
      group.push(c)
    } else {
      const fresh = [c]
      groups.set(bond, fresh)
      result.push(fresh)
    }
  }
  return result.flat()
}

interface Member {
  campaign: Campaign
  list: ListState
  need: number
  endsIn: number
  notMined?: NotMinedReason
}

/** The automatic sorts: compared unit by unit (a game, a game's channel set, or a campaign). */
function autoOrder(
  members: readonly Member[],
  options: QueueOptions,
  preferences: MiningPreferences
): Member[] {
  const sort = options.sort === 'custom' ? options.baseSort : options.sort
  const byEnd = (a: Member, b: Member): number => a.endsIn - b.endsIn
  const units = new Map<string, Member[]>()
  for (const m of [...members].sort(byEnd)) {
    const key = pieceKeyOf(m.campaign, options.layout)
    units.set(key, [...(units.get(key) ?? []), m])
  }
  const tier = (m: Member): number => {
    if (m.list !== 'priority') return preferences.priority.length + 1
    return sort === 'priority' ? preferences.priority.indexOf(m.campaign.game.name) : 0
  }
  const notMined = (m: Member): number => (m.notMined ? 1 : 0)
  const key = (m: Member): number =>
    sort === 'priority' ? m.need : sort === 'ending' ? m.endsIn : m.endsIn - m.need
  const best = (unit: readonly Member[]): readonly number[] => {
    const scores = unit.map((m) => [tier(m), options.linkedFirst ? notMined(m) : 0, key(m)])
    return scores.sort(compareScores)[0]!
  }
  return [...units.values()]
    .map((unit) => ({ unit, score: best(unit) }))
    .sort((a, b) => compareScores(a.score, b.score))
    .flatMap(({ unit }) => unit)
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The stored custom order, with campaigns that left dropped and new ones slotted in. */
function customOrder(
  members: readonly Member[],
  options: QueueOptions
): { ordered: Member[]; added: Set<string> } {
  const byId = new Map(members.map((m) => [m.campaign.id, m]))
  const ordered = options.order.flatMap((id) => {
    const m = byId.get(id)
    return m ? [m] : []
  })
  const known = new Set(ordered.map((m) => m.campaign.id))
  const added = new Set<string>()
  const fresh = members.filter((m) => !known.has(m.campaign.id)).sort((a, b) => a.endsIn - b.endsIn)
  for (const m of fresh) {
    added.add(m.campaign.id)
    // After the last campaign that ends sooner, so the user's top choices stay on top.
    const sooner = ordered.findLastIndex((o) => o.endsIn <= m.endsIn)
    if (options.newInCustom === 'end') ordered.push(m)
    else ordered.splice(sooner + 1, 0, m)
  }
  return { ordered, added }
}

export function buildQueue(input: {
  campaigns: readonly Campaign[]
  preferences: MiningPreferences
  options: QueueOptions
  ctx: EarnContext
  /** The campaign being mined: shown in Current, so left out of the pieces. */
  current?: Campaign
}): Queue {
  const { campaigns, preferences, options, ctx, current } = input
  const { now } = ctx
  const members: Member[] = []
  const excludedMembers: Member[] = []
  for (const c of campaigns) {
    if (!isQueueable(c, now)) continue
    const list = listOf(c.game, preferences)
    const reason = notMinedReason(c, ctx, preferences, list)
    const member: Member = {
      campaign: c,
      list,
      need: neededMinutes(c, options.dropProgress, now),
      endsIn: minutesUntil(c.endsAt, now),
      ...(reason ? { notMined: reason } : {})
    }
    if (list === 'excluded') excludedMembers.push(member)
    else members.push(member)
  }

  const custom = options.sort === 'custom' ? customOrder(members, options) : undefined
  let ordered = custom ? custom.ordered : autoOrder(members, options, preferences)
  const focus = options.focus
    ? ordered.find((m) => m.campaign.id === options.focus && !m.notMined)
    : undefined
  if (focus) ordered = [focus, ...ordered.filter((m) => m !== focus)]
  const byCampaign = new Map(ordered.map((m) => [m.campaign, m]))
  ordered = normaliseOrder(
    ordered.map((m) => m.campaign),
    options.split
  ).map((c) => byCampaign.get(c)!)

  // The miner's ranking: queue position, mined campaigns only (the current one keeps its place).
  const rank = new Map<string, number>()
  ordered.forEach((m, i) => {
    if (!m.notMined && canEarnCampaign(m.campaign, ctx)) rank.set(m.campaign.id, i)
  })

  // Play the queue forward: the current campaign first, then each mined campaign in turn.
  const currentMember = current ? ordered.find((m) => m.campaign.id === current.id) : undefined
  const currentNeed =
    currentMember?.need ?? (current ? neededMinutes(current, options.dropProgress, now) : 0)
  const credit = new Map<string, number>()
  const creditedBy = new Map<string, string[]>()
  const together = options.campaignProgress === 'together'
  const shareProgress = (from: Campaign, minutes: number, later: readonly Member[]): void => {
    if (!together || minutes <= 0) return
    for (const m of later) {
      if (m.notMined || m.campaign.id === from.id || !shareChannel(from, m.campaign)) continue
      credit.set(m.campaign.id, (credit.get(m.campaign.id) ?? 0) + minutes)
      creditedBy.set(m.campaign.id, [...(creditedBy.get(m.campaign.id) ?? []), from.id])
    }
  }
  const queued = ordered.filter((m) => m !== currentMember)
  if (current) shareProgress(current, currentNeed, queued)
  let clock = currentNeed
  const estimates = new Map<string, Pick<QueueEntry, 'startsInMinutes' | 'warning'>>()
  queued.forEach((m, i) => {
    if (m.notMined) return
    const need = Math.max(0, m.need - (credit.get(m.campaign.id) ?? 0))
    const startsIn = clock
    clock += need
    const late = clock > m.endsIn
    estimates.set(m.campaign.id, {
      startsInMinutes: startsIn,
      ...(late ? { warning: { savedAtTop: currentNeed + m.need <= m.endsIn } } : {})
    })
    shareProgress(m.campaign, need, queued.slice(i + 1))
  })

  const entry = (m: Member): QueueEntry => ({
    campaign: m.campaign,
    needMinutes: m.need,
    ...estimates.get(m.campaign.id),
    isNew: custom?.added.has(m.campaign.id) ?? false,
    mined: !m.notMined,
    ...(m.notMined ? { notMined: m.notMined } : {}),
    progressesWith: creditedBy.get(m.campaign.id) ?? []
  })

  const pieces: QueuePiece[] = []
  for (const m of queued) {
    const last = pieces.at(-1)
    const key = pieceKeyOf(m.campaign, options.layout)
    if (last && pieceKeyOf(last.entries[0]!.campaign, options.layout) === key) {
      last.entries.push(entry(m))
      last.focus ||= m === focus
    } else {
      pieces.push({
        key: m.campaign.id,
        game: m.campaign.game,
        list: m.list,
        split: false,
        focus: m === focus,
        entries: [entry(m)]
      })
    }
  }
  for (const p of pieces) p.split = pieces.some((o) => o !== p && o.game.id === p.game.id)

  const excludedGames = new Map<string, QueuePiece>()
  for (const m of [...excludedMembers].sort((a, b) => a.endsIn - b.endsIn)) {
    const piece = excludedGames.get(m.campaign.game.id)
    if (piece) {
      piece.entries.push(entry(m))
    } else {
      excludedGames.set(m.campaign.game.id, {
        key: m.campaign.id,
        game: m.campaign.game,
        list: 'excluded',
        split: false,
        focus: false,
        entries: [entry(m)]
      })
    }
  }

  return {
    pieces,
    excluded: [...excludedGames.values()],
    order: ordered.map((m) => m.campaign.id),
    currentNeedMinutes: currentNeed,
    rank
  }
}
