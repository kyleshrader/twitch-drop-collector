// Domain state → the plain views the renderer gets (dates as ISO strings, no class instances).
import {
  awaitsConnection,
  currentMinutes,
  hasBadgeOrEmote,
  isActive,
  isUpcoming,
  watchBlocker,
  type Campaign,
  type Channel,
  type Drop,
  type EarnContext,
  type MinerSnapshot,
  type Queue,
  type QueueEntry,
  type QueuePiece,
  type WatchBlocker
} from '@tdc/core'
import type {
  CampaignView,
  ChannelView,
  DropView,
  KnownGameView,
  MinerView,
  QueueEntryView,
  QueuePieceView,
  QueueView
} from '@tdc/ipc-contract'

export function channelView(c: Channel, unwatchable?: WatchBlocker): ChannelView {
  return {
    id: c.id,
    login: c.login,
    ...(c.displayName ? { displayName: c.displayName } : {}),
    aclBased: c.aclBased,
    online: c.stream !== undefined,
    ...(c.stream?.game ? { game: c.stream.game.name } : {}),
    ...(c.stream ? { viewers: c.stream.viewers, dropsEnabled: c.stream.dropsEnabled } : {}),
    ...(unwatchable ? { unwatchable } : {})
  }
}

/** What the app knows beyond Twitch's data: its own history (docs/new-ui/ui-design.md). */
export interface ViewHistory {
  /** Claim times this app recorded, by drop ID. */
  claimedAt: ReadonlyMap<string, Date>
  /** First-seen times, by campaign ID. */
  firstSeen: ReadonlyMap<string, Date>
  /** Campaigns seen, by game ID. */
  seenByGame: ReadonlyMap<string, number>
}

export const NO_HISTORY: ViewHistory = {
  claimedAt: new Map(),
  firstSeen: new Map(),
  seenByGame: new Map()
}

export function dropView(
  d: Drop,
  c: Campaign,
  now: Date,
  history: ViewHistory = NO_HISTORY
): DropView {
  const imageUrl = d.benefits[0]?.imageUrl
  const claimedAt = d.claimed ? (history.claimedAt.get(d.id) ?? d.awardedAt) : undefined
  return {
    id: d.id,
    name: d.name,
    minutes: Math.min(currentMinutes(d), d.requiredMinutes),
    requiredMinutes: d.requiredMinutes,
    claimed: d.claimed,
    awaitsConnection: awaitsConnection(d, c, now),
    rewards: d.benefits.map((b) => b.name),
    ...(imageUrl ? { imageUrl } : {}),
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    ...(claimedAt ? { claimedAt: claimedAt.toISOString() } : {})
  }
}

const stateOf = (c: Campaign, now: Date): CampaignView['state'] =>
  isActive(c, now) ? 'active' : isUpcoming(c, now) ? 'upcoming' : 'expired'

export function campaignView(
  c: Campaign,
  now: Date,
  history: ViewHistory = NO_HISTORY
): CampaignView {
  const firstSeen = history.firstSeen.get(c.id)
  return {
    id: c.id,
    name: c.name,
    game: c.game.name,
    gameId: c.game.id,
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    ...(c.game.boxArtUrl ? { boxArtUrl: c.game.boxArtUrl } : {}),
    ...(c.game.slug ? { gameSlug: c.game.slug } : {}),
    state: stateOf(c, now),
    linked: c.linked,
    ...(c.linkUrl ? { linkUrl: c.linkUrl } : {}),
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    allowListed: c.allowedChannels.length > 0,
    allowedChannels: c.allowedChannels.map((a) => a.displayName ?? a.login),
    allowedLogins: c.allowedChannels.map((a) => a.login),
    badgesEmotes: hasBadgeOrEmote(c),
    ...(firstSeen ? { firstSeenAt: firstSeen.toISOString() } : {}),
    drops: c.drops.map((d) => dropView(d, c, now, history))
  }
}

const entryView = (e: QueueEntry): QueueEntryView => ({
  campaignId: e.campaign.id,
  needMinutes: e.needMinutes,
  ...(e.startsInMinutes !== undefined ? { startsInMinutes: e.startsInMinutes } : {}),
  ...(e.warning ? { warning: e.warning } : {}),
  isNew: e.isNew,
  mined: e.mined,
  ...(e.notMined ? { notMined: e.notMined } : {}),
  progressesWith: e.progressesWith
})

const pieceView = (p: QueuePiece): QueuePieceView => ({
  key: p.key,
  game: p.game.name,
  list: p.list,
  split: p.split,
  focus: p.focus,
  entries: p.entries.map(entryView)
})

export const queueView = (q: Queue): QueueView => ({
  pieces: q.pieces.map(pieceView),
  excluded: q.excluded.map(pieceView),
  order: q.order,
  currentNeedMinutes: q.currentNeedMinutes
})

const STATE_ORDER: Record<CampaignView['state'], number> = { active: 0, upcoming: 1, expired: 2 }

export function toMinerView(
  snapshot: MinerSnapshot,
  campaigns: readonly Campaign[],
  channels: readonly Channel[],
  ctx: EarnContext,
  history: ViewHistory = NO_HISTORY
): MinerView {
  const { now } = ctx
  const views = campaigns
    .map((c) => campaignView(c, now, history))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.endsAt.localeCompare(b.endsAt))
  const active = snapshot.active
  // The same rule the miner follows for manual picks, so the list only offers picks that work.
  const view = (c: Channel): ChannelView =>
    channelView(c, watchBlocker(c, campaigns, snapshot.wanted, ctx))
  return {
    status: snapshot.status,
    ...(snapshot.message ? { message: snapshot.message } : {}),
    ...(snapshot.watching ? { watching: view(snapshot.watching) } : {}),
    ...(active
      ? {
          active: {
            campaignId: active.campaign.id,
            campaign: active.campaign.name,
            game: active.campaign.game.name,
            ...(active.drop ? { drop: dropView(active.drop, active.campaign, now) } : {})
          }
        }
      : {}),
    wanted: snapshot.wanted.map((g) => g.name),
    ...(snapshot.selectedId ? { selected: snapshot.selectedId } : {}),
    channels: channels.map(view),
    campaigns: views,
    ...(history.seenByGame.size > 0 ? { seenByGame: Object.fromEntries(history.seenByGame) } : {})
  }
}

/** Fills a campaign's missing box art and game address from what's saved about its game. */
export function withGameInfo(
  campaigns: readonly CampaignView[],
  games: Readonly<Record<string, KnownGameView>>
): CampaignView[] {
  return campaigns.map((c) => {
    const known = games[c.game]
    if (!known || (c.boxArtUrl && c.gameSlug)) return c
    return {
      ...c,
      ...(!c.boxArtUrl && known.boxArtUrl ? { boxArtUrl: known.boxArtUrl } : {}),
      ...(!c.gameSlug && known.slug ? { gameSlug: known.slug } : {})
    }
  })
}
