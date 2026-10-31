// Builds the miner and everything it needs, and runs it while the user is signed in.
import {
  createGqlClient,
  createHlsWatcher,
  createPubSub,
  systemScheduler,
  type HttpClient,
  type TwitchEndpoints,
  type WebSocketLike
} from '@tdc/api'
import type { SettingsService } from '@tdc/config'
import {
  createChannelService,
  createInventoryService,
  createMiner,
  createWatchService,
  type AuthService,
  type AuthState,
  type ClaimNotice
} from '@tdc/core'
import { createRateLimiter, systemClock, type Logger } from '@tdc/kernel'
import type { MinerView } from '@tdc/ipc-contract'
import type { Storage } from '@tdc/storage'
import { toMinerView } from './views'

export interface MiningRuntime {
  view(): MinerView
  /** Called (throttled by the caller) whenever anything in the view may have changed. */
  onChange(listener: () => void): () => void
  reload(): void
  selectChannel(channelId: string | undefined): void
  stop(): Promise<void>
}

export function createMiningRuntime(deps: {
  http: HttpClient
  auth: AuthService
  settings: SettingsService
  storage: Storage
  endpoints: TwitchEndpoints
  connect: (url: string) => WebSocketLike
  onClaim: (notice: ClaimNotice) => void
  logger: Logger
}): MiningRuntime {
  const { http, auth, settings, storage, endpoints, logger } = deps
  const clock = systemClock
  const scheduler = systemScheduler

  const gql = createGqlClient({
    http,
    auth: auth.gqlAuth,
    url: endpoints.gql,
    // Twitch's GQL rate limit, as upstream: at most 5 requests per second.
    limiter: createRateLimiter({ capacity: 5, windowMs: 1000, clock, scheduler }),
    scheduler,
    logger: logger.child('gql')
  })
  const realtime = createPubSub({
    url: endpoints.pubsub,
    connect: deps.connect,
    accessToken: () => auth.accessToken(),
    scheduler,
    logger: logger.child('pubsub')
  })
  const userId = (): string => {
    const state = auth.state()
    return state.status === 'signedIn' ? state.user.id : ''
  }
  const inventory = createInventoryService({
    gql,
    userId,
    claims: storage.claims,
    clock,
    logger: logger.child('inventory')
  })
  const channels = createChannelService({
    gql,
    availableDropsCheck: () => settings.get().mining.availableDropsCheck,
    logger: logger.child('channels')
  })
  const watch = createWatchService({
    watcher: createHlsWatcher({
      http,
      gql,
      usherUrl: endpoints.usher,
      logger: logger.child('watch')
    }),
    scheduler,
    clock,
    logger: logger.child('watch')
  })
  const miner = createMiner({
    inventory,
    channels,
    watch,
    realtime,
    gql,
    userId,
    preferences: () => settings.get().mining,
    clock,
    scheduler,
    logger: logger.child('miner'),
    onClaim: deps.onClaim
  })

  // Mine while signed in; stop on sign-out (and restart cleanly on the next sign-in).
  let mining = false
  const follow = (state: AuthState): void => {
    if (state.status === 'signedIn' && !mining) {
      mining = true
      logger.info('Starting the miner', { userId: state.user.id })
      miner.start()
    } else if (state.status === 'signedOut' && mining) {
      mining = false
      logger.info('Stopping the miner')
      void miner.stop()
    }
  }
  const offAuth = auth.onChange(follow)
  follow(auth.state())

  const offSettings = settings.subscribe((next, previous) => {
    if (mining && JSON.stringify(next.mining) !== JSON.stringify(previous.mining)) {
      miner.refreshGames()
    }
  })

  return {
    view: () =>
      toMinerView(miner.snapshot(), inventory.campaigns(), channels.channels(), clock.now()),
    onChange(listener) {
      const offs = [
        miner.onChange(listener),
        inventory.onChange(listener),
        channels.onChange(listener)
      ]
      return () => offs.forEach((off) => off())
    },
    reload: () => miner.reload(),
    selectChannel: (channelId) => miner.selectChannel(channelId),
    async stop() {
      offAuth()
      offSettings()
      mining = false
      await miner.stop()
    }
  }
}
