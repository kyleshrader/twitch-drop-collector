// What the renderer sees of the miner: plain, serialisable views built in main.
import { z } from 'zod'

export const ChannelView = z.object({
  id: z.string(),
  login: z.string(),
  displayName: z.string().optional(),
  aclBased: z.boolean(),
  online: z.boolean(),
  game: z.string().optional(),
  viewers: z.number().optional(),
  dropsEnabled: z.boolean().optional(),
  /** Why watching it wouldn't progress a wanted drop; absent when it would. */
  unwatchable: z.enum(['offline', 'dropsOff', 'otherGame', 'nothingToEarn']).optional()
})
export type ChannelView = z.infer<typeof ChannelView>

export const DropView = z.object({
  id: z.string(),
  name: z.string(),
  minutes: z.number(),
  requiredMinutes: z.number(),
  claimed: z.boolean(),
  /** Finished, but only claimable once the game account is connected. */
  awaitsConnection: z.boolean(),
  rewards: z.array(z.string()),
  imageUrl: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  /** When it was claimed: by this app, or as Twitch reports the award. Absent when unknown. */
  claimedAt: z.string().optional()
})
export type DropView = z.infer<typeof DropView>

export const CampaignView = z.object({
  id: z.string(),
  name: z.string(),
  game: z.string(),
  gameId: z.string(),
  imageUrl: z.string().optional(),
  /** The game's box art (portrait, 285×380 at full size). */
  boxArtUrl: z.string().optional(),
  /** The game's address on Twitch: twitch.tv/directory/category/<slug>. */
  gameSlug: z.string().optional(),
  state: z.enum(['active', 'upcoming', 'expired']),
  linked: z.boolean(),
  linkUrl: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  allowListed: z.boolean(),
  /** The only channels that count, by name; empty when any channel streaming the game does. */
  allowedChannels: z.array(z.string()),
  /** The same channels' logins (their twitch.tv addresses), in the same order. */
  allowedLogins: z.array(z.string()).optional(),
  /** Rewards include a badge or emote; such campaigns never need a linked account. */
  badgesEmotes: z.boolean(),
  /** When this app first saw the campaign (absent before the app kept a history). */
  firstSeenAt: z.string().optional(),
  drops: z.array(DropView)
})
export type CampaignView = z.infer<typeof CampaignView>

/** One campaign in the Up next queue (docs/new-ui/queue-rules.md); details are in CampaignView. */
export const QueueEntryView = z.object({
  campaignId: z.string(),
  needMinutes: z.number(),
  /** Estimated minutes until it starts progressing; mined campaigns only. */
  startsInMinutes: z.number().optional(),
  /** Won't finish before it ends, by the estimate. */
  warning: z.object({ savedAtTop: z.boolean() }).optional(),
  /** New in a custom order since the user last changed it. */
  isNew: z.boolean(),
  mined: z.boolean(),
  notMined: z.enum(['notLinked', 'badgesOff', 'priorityOnly']).optional(),
  /** Campaigns whose watching also progresses this one (campaignProgress "together"). */
  progressesWith: z.array(z.string())
})
export type QueueEntryView = z.infer<typeof QueueEntryView>

export const QueuePieceView = z.object({
  key: z.string(),
  game: z.string(),
  list: z.enum(['priority', 'notSet', 'excluded']),
  split: z.boolean(),
  focus: z.boolean(),
  entries: z.array(QueueEntryView)
})
export type QueuePieceView = z.infer<typeof QueuePieceView>

export const QueueView = z.object({
  pieces: z.array(QueuePieceView),
  excluded: z.array(QueuePieceView),
  /** Every queued campaign in order, the current one included: what a custom order starts from. */
  order: z.array(z.string()),
  currentNeedMinutes: z.number()
})
export type QueueView = z.infer<typeof QueueView>

/** A game's ID, address on Twitch (directory/category/<slug>) and box art, as far as known. */
export const KnownGameView = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  boxArtUrl: z.string().optional()
})
export type KnownGameView = z.infer<typeof KnownGameView>

export const MinerView = z.object({
  /** `paused`: offline or the computer is asleep; mining resumes by itself. */
  status: z.enum(['stopped', 'loading', 'idle', 'watching', 'error', 'paused']),
  message: z.string().optional(),
  watching: ChannelView.optional(),
  active: z
    .object({
      campaignId: z.string(),
      campaign: z.string(),
      game: z.string(),
      drop: DropView.optional()
    })
    .optional(),
  wanted: z.array(z.string()),
  /** ID of the channel the user picked, while the pick stands. */
  selected: z.string().optional(),
  channels: z.array(ChannelView),
  campaigns: z.array(CampaignView),
  /** Paused by the user (queue.paused), not by the connection. */
  userPaused: z.boolean().optional(),
  queue: QueueView.optional(),
  /** Campaigns ever seen by this app, by game ID (including ones Twitch no longer lists). */
  seenByGame: z.record(z.string(), z.number()).optional(),
  /** What the app knows about games by name (saved and refreshed): for games on a list too. */
  games: z.record(z.string(), KnownGameView).optional(),
  /** The signed-in account's profile picture. */
  avatarUrl: z.string().optional()
})
export type MinerView = z.infer<typeof MinerView>

export const SelectChannelInput = z.object({ channelId: z.string().optional() })
