// Auth flow, drop collection and domain rules. May import kernel, api, storage and config only.
export {
  activationUrl,
  createAuthService,
  NotSignedInError,
  type AuthService,
  type AuthState,
  type LoginWindow,
  type SessionStore,
  type SignInMethod,
  type StoredSession,
  type TwitchUser
} from './auth/auth-service'
export { createChannelService, type ChannelService } from './channels/channel-service'
export {
  createConnectivity,
  type Connectivity,
  type ConnectivityState,
  type PowerEvents
} from './connectivity/connectivity'
export {
  awaitsConnection,
  currentMinutes,
  hasBadgeOrEmote,
  isActive,
  isUpcoming,
  type EarnContext
} from './domain/rules'
export { watchBlocker, type CampaignRank, type WatchBlocker } from './domain/selection'
export {
  buildQueue,
  channelKey,
  neededMinutes,
  normaliseOrder,
  queueOptions,
  type ListState,
  type NotMinedReason,
  type Queue,
  type QueueEntry,
  type QueueOptions,
  type QueuePiece
} from './queue/queue'
export type {
  Benefit,
  Campaign,
  Channel,
  Drop,
  Game,
  MiningPreferences,
  Stream
} from './domain/types'
export { createInventoryService, type InventoryService } from './inventory/inventory-service'
export { withoutImageSize } from './inventory/mapping'
export {
  createMiner,
  type ClaimNotice,
  type Miner,
  type MinerSnapshot,
  type MinerStatus
} from './miner/miner'
export { createWatchService, type WatchService } from './watch/watch-service'
