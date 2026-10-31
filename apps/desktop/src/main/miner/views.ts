// Domain state → the plain views the renderer gets (dates as ISO strings, no class instances).
import {
  currentMinutes,
  isActive,
  isUpcoming,
  type Campaign,
  type Channel,
  type Drop,
  type MinerSnapshot
} from '@tdc/core'
import type { CampaignView, ChannelView, DropView, MinerView } from '@tdc/ipc-contract'

export function channelView(c: Channel): ChannelView {
  return {
    id: c.id,
    login: c.login,
    ...(c.displayName ? { displayName: c.displayName } : {}),
    aclBased: c.aclBased,
    online: c.stream !== undefined,
    ...(c.stream?.game ? { game: c.stream.game.name } : {}),
    ...(c.stream ? { viewers: c.stream.viewers, dropsEnabled: c.stream.dropsEnabled } : {})
  }
}

export function dropView(d: Drop): DropView {
  const imageUrl = d.benefits[0]?.imageUrl
  return {
    id: d.id,
    name: d.name,
    minutes: Math.min(currentMinutes(d), d.requiredMinutes),
    requiredMinutes: d.requiredMinutes,
    claimed: d.claimed,
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
    drops: c.drops.map(dropView)
  }
}

const STATE_ORDER: Record<CampaignView['state'], number> = { active: 0, upcoming: 1, expired: 2 }

export function toMinerView(
  snapshot: MinerSnapshot,
  campaigns: readonly Campaign[],
  channels: readonly Channel[],
  now: Date
): MinerView {
  const views = campaigns
    .map((c) => campaignView(c, now))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.endsAt.localeCompare(b.endsAt))
  const active = snapshot.active
  return {
    status: snapshot.status,
    ...(snapshot.message ? { message: snapshot.message } : {}),
    ...(snapshot.watching ? { watching: channelView(snapshot.watching) } : {}),
    ...(active
      ? {
          active: {
            campaignId: active.campaign.id,
            campaign: active.campaign.name,
            game: active.campaign.game.name,
            ...(active.drop ? { drop: dropView(active.drop) } : {})
          }
        }
      : {}),
    wanted: snapshot.wanted.map((g) => g.name),
    channels: channels.map(channelView),
    campaigns: views
  }
}
