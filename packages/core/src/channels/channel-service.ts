// The channels the miner may watch: discovered from wanted campaigns, kept live-accurate.
import { gql, type GqlClient } from '@tdc/api'
import { createEmitter, type Logger } from '@tdc/kernel'
import { canEarnCampaign, canEarnCampaignWithin, type EarnContext } from '../domain/rules'
import { capChannels, PLANNING_HORIZON_MS, rankChannels } from '../domain/selection'
import type { Campaign, Channel, Game, Stream } from '../domain/types'

/** Live channels requested per game from the directory (as upstream). */
export const DIRECTORY_LIMIT = 20

export interface ChannelService {
  channels(): readonly Channel[]
  get(id: string): Channel | undefined
  /** Rebuilds the tracked channels for the wanted games (discovery, online check, ranking). */
  refresh(
    input: { campaigns: readonly Campaign[]; wanted: readonly Game[]; ctx: EarnContext },
    signal?: AbortSignal
  ): Promise<readonly Channel[]>
  /** Re-fetches one channel's stream. Returns the stream before and after. */
  updateStream(
    channelId: string,
    input: { campaigns: readonly Campaign[]; ctx: EarnContext },
    signal?: AbortSignal
  ): Promise<{ before?: Stream; after?: Stream } | undefined>
  /** The channel went offline. Returns the stream it had. */
  setOffline(channelId: string): Stream | undefined
  setViewers(channelId: string, viewers: number): void
  onChange(listener: (channels: readonly Channel[]) => void): () => void
}

/** Twitch's directory slug for a game name, for games that didn't come with one. */
export function gameSlug(game: Game): string {
  if (game.slug) return game.slug
  return game.name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\W+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

const toGame = (raw: {
  id: string
  name?: string | null
  displayName?: string | null
  slug?: string | null
}): Game => ({
  id: raw.id,
  name: raw.displayName ?? raw.name ?? raw.id,
  ...(raw.slug ? { slug: raw.slug } : {})
})

type StreamInfo = ReturnType<typeof gql.StreamInfo.data.parse>['user']

export function createChannelService(deps: {
  gql: GqlClient
  /** The "available drops check" setting: confirm drops per channel instead of trusting tags. */
  availableDropsCheck: () => boolean
  logger: Logger
}): ChannelService {
  const { gql: client, availableDropsCheck, logger } = deps
  const events = createEmitter<{ change: readonly Channel[] }>({
    onListenerError: (error) => logger.error('Channel listener failed', { error })
  })
  let channels: readonly Channel[] = []

  const publish = (next: readonly Channel[]): void => {
    channels = next
    events.emit('change', next)
  }
  const replace = (updated: Channel): void =>
    publish(channels.map((c) => (c.id === updated.id ? updated : c)))
  const get = (id: string): Channel | undefined => channels.find((c) => c.id === id)

  const toStream = (user: NonNullable<StreamInfo>): Stream | undefined => {
    if (!user.stream) return undefined
    const game = user.broadcastSettings?.game
    return {
      id: user.stream.id,
      ...(game ? { game: toGame(game) } : {}),
      viewers: user.stream.viewersCount,
      title: user.broadcastSettings?.title ?? '',
      // Without the check, trust the stream; with it, set below from AvailableDrops.
      dropsEnabled: !availableDropsCheck()
    }
  }

  /** With the available-drops check on: does any campaign we could earn run on this channel? */
  const confirmDrops = async (
    live: Channel[],
    campaigns: readonly Campaign[],
    ctx: EarnContext,
    signal?: AbortSignal
  ): Promise<Channel[]> => {
    if (!availableDropsCheck() || live.length === 0) return live
    const results = await client.batch(
      gql.AvailableDrops,
      live.map((c) => ({ channelId: c.id })),
      signal
    )
    return live.map((channel, i) => {
      const ids = new Set((results[i]?.channel?.viewerDropCampaigns ?? []).map((c) => c.id))
      const dropsEnabled = campaigns.some(
        (c) => ids.has(c.id) && canEarnCampaign(c, ctx, channel, { ignoreChannelStatus: true })
      )
      return channel.stream ? { ...channel, stream: { ...channel.stream, dropsEnabled } } : channel
    })
  }

  return {
    channels: () => channels,
    get,

    async refresh({ campaigns, wanted, ctx }, signal) {
      const cutoff = new Date(ctx.now.getTime() + PLANNING_HORIZON_MS)
      const relevant = campaigns.filter(
        (c) => wanted.some((g) => g.id === c.game.id) && canEarnCampaignWithin(c, ctx, cutoff)
      )

      // Channels on allow-lists: check which are live, in bulk.
      const acl = new Map<string, Channel>()
      for (const c of relevant) {
        for (const a of c.allowedChannels) {
          acl.set(a.id, {
            id: a.id,
            login: a.login,
            ...(a.displayName ? { displayName: a.displayName } : {}),
            aclBased: true
          })
        }
      }
      const aclList = [...acl.values()]
      const infos = await client.batch(
        gql.StreamInfo,
        aclList.map((c) => ({ login: c.login })),
        signal
      )
      const checked = aclList.map((channel, i) => {
        const user = infos[i]?.user
        const stream = user ? toStream(user) : undefined
        return {
          ...channel,
          ...(user?.displayName && !channel.displayName ? { displayName: user.displayName } : {}),
          ...(stream ? { stream } : {})
        }
      })
      const aclChannels = [
        ...(await confirmDrops(
          checked.filter((c) => c.stream),
          campaigns,
          ctx,
          signal
        )),
        ...checked.filter((c) => !c.stream)
      ]

      // Games without allow-lists: live, drops-enabled channels from the directory.
      const directoryGames = new Map<string, Game>()
      for (const c of relevant) {
        if (c.allowedChannels.length === 0) directoryGames.set(c.game.id, c.game)
      }
      const directory: Channel[] = []
      for (const game of directoryGames.values()) {
        const result = await client.request(
          gql.GameDirectory,
          { slug: gameSlug(game), limit: DIRECTORY_LIMIT, dropsEnabledOnly: true },
          signal
        )
        for (const edge of result.game?.streams?.edges ?? []) {
          const { node } = edge
          if (!node.broadcaster || acl.has(node.broadcaster.id)) continue
          directory.push({
            id: node.broadcaster.id,
            login: node.broadcaster.login,
            ...(node.broadcaster.displayName ? { displayName: node.broadcaster.displayName } : {}),
            aclBased: false,
            stream: {
              id: node.id,
              ...(node.game ? { game: toGame(node.game) } : { game }),
              viewers: node.viewersCount,
              title: node.title ?? '',
              dropsEnabled: true
            }
          })
        }
      }

      const unique = new Map<string, Channel>()
      for (const c of [...aclChannels, ...directory]) if (!unique.has(c.id)) unique.set(c.id, c)
      const ranked = capChannels(rankChannels([...unique.values()], wanted))
      logger.info('Channels refreshed', {
        allowListed: aclChannels.length,
        fromDirectory: directory.length,
        tracked: ranked.length
      })
      publish(ranked)
      return ranked
    },

    async updateStream(channelId, { campaigns, ctx }, signal) {
      const channel = get(channelId)
      if (!channel) return undefined
      const result = await client.request(gql.StreamInfo, { login: channel.login }, signal)
      const before = channel.stream
      const stream = result.user ? toStream(result.user) : undefined
      let updated: Channel = { ...channel }
      if (stream) updated.stream = stream
      else delete updated.stream
      if (stream) updated = (await confirmDrops([updated], campaigns, ctx, signal))[0] ?? updated
      if (!get(channelId)) return undefined // removed meanwhile
      replace(updated)
      return { ...(before ? { before } : {}), ...(updated.stream ? { after: updated.stream } : {}) }
    },

    setOffline(channelId) {
      const channel = get(channelId)
      if (!channel?.stream) return undefined
      const { stream, ...offline } = channel
      replace(offline)
      return stream
    },

    setViewers(channelId, viewers) {
      const channel = get(channelId)
      if (channel?.stream) replace({ ...channel, stream: { ...channel.stream, viewers } })
    },

    onChange: (listener) => events.on('change', listener)
  }
}
