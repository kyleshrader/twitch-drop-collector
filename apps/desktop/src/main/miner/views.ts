// Domain state → the plain views the renderer gets (dates as ISO strings, no class instances).
import {
  awaitsConnection,
  currentMinutes,
  isActive,
  isUpcoming,
  watchBlocker,
  type Campaign,
  type Channel,
  type Drop,
  type EarnContext,
  type MinerSnapshot,
  type WatchBlocker
} from '@tdc/core'
import type { CampaignView, ChannelView, DropView, MinerView } from '@tdc/ipc-contract'

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

export function dropView(d: Drop, c: Campaign, now: Date): DropView {
  const imageUrl = d.benefits[0]?.imageUrl
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
    endsAt: d.endsAt.toISOString()
  }
}

const stateOf = (c: Campaign, now: Date): CampaignView['state'] =>
  isActive(c, now) ? 'active' : isUpcoming(c, now) ? 'upcoming' : 'expired'

export function campaignView(c: Campaign, now: Date): CampaignView {
  return {
    id: c.id,
    name: c.name,
    game: c.game.name,
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    state: stateOf(c, now),
    linked: c.linked,
    ...(c.linkUrl ? { linkUrl: c.linkUrl } : {}),
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    allowListed: c.allowedChannels.length > 0,
    drops: c.drops.map((d) => dropView(d, c, now))
  }
}

const STATE_ORDER: Record<CampaignView['state'], number> = { active: 0, upcoming: 1, expired: 2 }

export function toMinerView(
  snapshot: MinerSnapshot,
  campaigns: readonly Campaign[],
  channels: readonly Channel[],
  ctx: EarnContext
): MinerView {
  const { now } = ctx
  const views = campaigns
    .map((c) => campaignView(c, now))
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
    campaigns: views
  }
}
