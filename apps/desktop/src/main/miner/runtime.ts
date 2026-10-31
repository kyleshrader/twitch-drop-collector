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
  type ClaimNotice,
  type Connectivity
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
  connectivity: Connectivity
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

  // Mine while signed in and connected; stop on sign-out, pause while offline or asleep. Every
  // start is a fresh one (full reload), so nothing stale survives a pause.
  const { connectivity } = deps
  let mining = false
  let resuming = false
  const follow = (state: AuthState): void => {
    const shouldMine = state.status === 'signedIn' && connectivity.state() === 'online'
    if (shouldMine && !mining) {
      mining = true
      logger.info('Starting the miner', { userId: state.user.id })
      miner.start()
    } else if (!shouldMine && mining && state.status !== 'signingIn') {
      mining = false
      logger.info('Stopping the miner', {
        reason: state.status === 'signedIn' ? 'paused' : 'signed out'
      })
      void miner.stop()
    }
  }
  const offAuth = auth.onChange(follow)
  const offConnectivity = connectivity.onChange((next) => {
    if (next !== 'online') return follow(auth.state())
    // Back online: re-check the saved session first (it may have expired meanwhile). Restoring
    // reports its state, which starts the miner when still signed in.
    resuming = true
    void auth
      .start()
      .finally(() => (resuming = false))
      .then(() => follow(auth.state()))
  })
  follow(auth.state())

  const paused = (): MinerView['message'] | undefined => {
    if (auth.state().status !== 'signedIn') return undefined
    const state = connectivity.state()
    if (state === 'offline') return 'Offline: mining resumes when the connection is back'
    if (state === 'asleep') return 'The computer is asleep'
    if (resuming) return 'Back online: checking your session…'
    return undefined
  }

  const offSettings = settings.subscribe((next, previous) => {
    if (mining && JSON.stringify(next.mining) !== JSON.stringify(previous.mining)) {
      miner.refreshGames()
    }
  })

  return {
    view() {
      const view = toMinerView(miner.snapshot(), inventory.campaigns(), channels.channels(), {
        now: clock.now(),
        preferences: settings.get().mining
      })
      const message = paused()
      if (message === undefined) return view
      // Paused: nothing is being watched, whatever the stopped miner last reported.
      return {
        status: 'paused',
        message,
        wanted: view.wanted,
        channels: view.channels,
        campaigns: view.campaigns
      }
    },
    onChange(listener) {
      const offs = [
        miner.onChange(listener),
        inventory.onChange(listener),
        channels.onChange(listener),
        connectivity.onChange(listener)
      ]
      return () => offs.forEach((off) => off())
    },
    reload: () => miner.reload(),
    selectChannel: (channelId) => miner.selectChannel(channelId),
    async stop() {
      offAuth()
      offConnectivity()
      offSettings()
      mining = false
      await miner.stop()
    }
  }
}
