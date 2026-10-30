// The miner's domain model: plain, immutable data. Rules are pure functions over these types
// (rules.ts, selection.ts); nothing here talks to Twitch or the UI.

export interface Game {
  id: string
  name: string
  slug?: string
  boxArtUrl?: string
}

export type BenefitType = 'BADGE' | 'EMOTE' | 'DIRECT_ENTITLEMENT' | 'UNKNOWN'

export interface Benefit {
  id: string
  name: string
  type: BenefitType
  imageUrl: string
}

export interface Drop {
  id: string
  name: string
  startsAt: Date
  endsAt: Date
  requiredMinutes: number
  /** Minutes Twitch has confirmed. */
  realMinutes: number
  /** Minutes we estimated while Twitch stopped reporting progress (capped at MAX_EXTRA_MINUTES). */
  extraMinutes: number
  /** Set once Twitch says the drop can be claimed. */
  claimId?: string
  claimed: boolean
  /** Drops in the same campaign that must be claimed first. */
  preconditionIds: string[]
  benefits: Benefit[]
}

/** Twitch's own campaign status; "valid" means anything but EXPIRED. */
export type CampaignStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED'

export interface AclChannel {
  id: string
  login: string
  displayName?: string
}

export interface Campaign {
  id: string
  name: string
  game: Game
  status: CampaignStatus
  startsAt: Date
  endsAt: Date
  /** Whether the user's account is linked to the game's account (required for most rewards). */
  linked: boolean
  linkUrl?: string
  imageUrl?: string
  /** Empty: any channel streaming the game counts. Otherwise only these channels. */
  allowedChannels: AclChannel[]
  drops: Drop[]
}

export interface Stream {
  id: string
  game?: Game
  viewers: number
  title: string
  dropsEnabled: boolean
}

export interface Channel {
  id: string
  login: string
  displayName?: string
  /** From a campaign's allowed-channel list (preferred over channels found in the directory). */
  aclBased: boolean
  /** Undefined while offline. */
  stream?: Stream
}

/** The mining settings the rules read (a subset of @tdc/config's MiningSettings). */
export interface MiningPreferences {
  priority: readonly string[]
  exclude: readonly string[]
  priorityMode: 'priorityOnly' | 'endingSoonest' | 'lowAvailabilityFirst'
  enableBadgesEmotes: boolean
}
