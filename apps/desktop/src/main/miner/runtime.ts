// Builds the miner and everything it needs, and runs it while the user is signed in.
import {
  createGqlClient,
  createHlsWatcher,
  gql as operations,
  createPubSub,
  systemScheduler,
  type HttpClient,
  type TwitchEndpoints,
  type WebSocketLike
} from '@tdc/api'
import type { Settings, SettingsService } from '@tdc/config'
import {
  buildQueue,
  createChannelService,
  createInventoryService,
  createMiner,
  createWatchService,
  withoutImageSize,
  queueOptions,
  type AuthService,
  type AuthState,
  type Campaign,
  type CampaignRank,
  type ClaimNotice,
  type Connectivity,
  type Queue
} from '@tdc/core'
import { createRateLimiter, systemClock, type Logger } from '@tdc/kernel'
import type { GameSearchResult, MinerView } from '@tdc/ipc-contract'
import type { Storage } from '@tdc/storage'
import { createGameInfoService } from './game-info'
import { queueView, toMinerView, withGameInfo, type ViewHistory } from './views'

/** How many games a search returns. */
const SEARCH_RESULTS = 12
/** How often saved game info is checked for games due a look-up (game-info.ts says when). */
const GAME_INFO_REFRESH_MS = 6 * 60 * 60 * 1000

export interface MiningRuntime {
  view(): MinerView
  /** Called (throttled by the caller) whenever anything in the view may have changed. */
  onChange(listener: () => void): () => void
  reload(): void
  selectChannel(channelId: string | undefined): void
  /** Twitch games whose name matches, best match first. */
  searchGames(query: string): Promise<GameSearchResult[]>
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
  // The Up next queue (docs/new-ui/queue-rules.md). It drives mining while the new UI is on;
  // the classic UI keeps the classic rules until the switch-over.
  const queueOf = (current?: Campaign): Queue => {
    return buildQueue({
      campaigns: inventory.campaigns(),
      preferences: settings.get().mining,
      options: queueOptions(settings.get().queue),
      ctx: { now: clock.now(), preferences: settings.get().mining },
      ...(current ? { current } : {})
    })
  }
  // The app's own history: when campaigns were first seen (recorded as the inventory loads) and
  // when drops were claimed. Read from the database only after something changed.
  let history: ViewHistory | undefined
  const recorded = new Set<string>()
  let claimedCount = -1
  const recordSeen = (list: readonly Campaign[]): void => {
    const fresh = list.filter((c) => !recorded.has(c.id))
    const claimed = list.reduce((n, c) => n + c.drops.filter((d) => d.claimed).length, 0)
    if (fresh.length > 0) {
      const added = storage.seen.record(
        fresh.map((c) => ({ id: c.id, gameId: c.game.id, gameName: c.game.name, name: c.name })),
        clock.now()
      )
      for (const c of fresh) recorded.add(c.id)
      if (added > 0) logger.debug('New campaigns seen', { added })
    }
    // Progress updates change neither; only re-read the history when campaigns or claims do.
    if (fresh.length > 0 || claimed !== claimedCount) history = undefined
    claimedCount = claimed
  }
  const historyNow = (): ViewHistory =>
    (history ??= {
      claimedAt: storage.claims.claimTimes(),
      firstSeen: storage.seen.firstSeen(),
      seenByGame: storage.seen.countByGame()
    })
  const offInventory = inventory.onChange(recordSeen)

  // Games' addresses and box art, saved and refreshed (game-info.ts); the account's picture.
  const gameInfo = createGameInfoService({
    gql,
    games: storage.games,
    clock,
    logger: logger.child('games')
  })
  const extraListeners = new Set<() => void>()
  const notify = (): void => extraListeners.forEach((listener) => listener())
  /** Games worth knowing about: on a list, or with a campaign. */
  const gameNames = (): string[] => [
    ...settings.get().mining.priority,
    ...settings.get().mining.exclude,
    ...inventory.campaigns().map((c) => c.game.name)
  ]
  const refreshGameInfo = (): void => {
    if (auth.state().status === 'signedIn') void gameInfo.refresh(gameNames())
  }
  const offInventoryGames = inventory.onChange((list) => {
    gameInfo.fromCampaigns(list)
    refreshGameInfo()
  })
  const gameInfoTimer = setInterval(refreshGameInfo, GAME_INFO_REFRESH_MS)
  gameInfoTimer.unref?.()
  let avatar: { userId: string; url?: string } | undefined
  const fetchAvatar = (id: string): void => {
    if (avatar?.userId === id) return
    avatar = { userId: id }
    void gql
      .request(operations.UserAvatar, { userId: id })
      .then((data) => {
        const url = data.user?.profileImageURL
        if (url && avatar?.userId === id) {
          avatar = { userId: id, url }
          notify()
        }
      })
      .catch((error: unknown) => logger.warn('Fetching the account picture failed', { error }))
  }

  const queueRank = (): CampaignRank | undefined =>
    settings.get().general.ui === 'next' ? queueOf().rank : undefined

  const miner = createMiner({
    inventory,
    channels,
    watch,
    realtime,
    gql,
    userId,
    preferences: () => settings.get().mining,
    queueRank,
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
    if (state.status === 'signedIn') {
      fetchAvatar(state.user.id)
      refreshGameInfo()
    }
    const shouldMine =
      state.status === 'signedIn' &&
      connectivity.state() === 'online' &&
      !settings.get().queue.paused
    if (shouldMine && !mining) {
      mining = true
      logger.info('Starting the miner', { userId: state.user.id })
      miner.start()
    } else if (!shouldMine && mining && state.status !== 'signingIn') {
      mining = false
      logger.info('Stopping the miner', {
        reason:
          state.status !== 'signedIn'
            ? 'signed out'
            : settings.get().queue.paused
              ? 'paused by the user'
              : 'paused'
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
    if (settings.get().queue.paused) return 'Paused'
    return undefined
  }

  /** What of the settings ranks channels: the queue, while the new UI is on. */
  const queueDrives = (s: Settings): string =>
    s.general.ui === 'next' ? JSON.stringify({ ...s.queue, paused: undefined }) : ''
  const offSettings = settings.subscribe((next, previous) => {
    if (next.queue.paused !== previous.queue.paused) follow(auth.state())
    const changed =
      JSON.stringify(next.mining) !== JSON.stringify(previous.mining) ||
      queueDrives(next) !== queueDrives(previous)
    if (mining && changed) miner.refreshGames()
    if (
      JSON.stringify([next.mining.priority, next.mining.exclude]) !==
      JSON.stringify([previous.mining.priority, previous.mining.exclude])
    ) {
      refreshGameInfo()
    }
  })

  /** What the view carries besides the miner: known games and the account picture. */
  const extras = (): Pick<MinerView, 'games' | 'avatarUrl'> => ({
    games: gameInfo.known(),
    ...(avatar?.url ? { avatarUrl: avatar.url } : {})
  })

  return {
    view() {
      const snapshot = miner.snapshot()
      const base = toMinerView(
        snapshot,
        inventory.campaigns(),
        channels.channels(),
        { now: clock.now(), preferences: settings.get().mining },
        historyNow()
      )
      const view = { ...base, campaigns: withGameInfo(base.campaigns, gameInfo.known()) }
      const message = paused()
      const userPaused = settings.get().queue.paused
      if (message === undefined) {
        return { ...view, ...extras(), queue: queueView(queueOf(snapshot.active?.campaign)) }
      }
      // Paused: nothing is being watched, whatever the stopped miner last reported.
      return {
        status: 'paused',
        message,
        wanted: view.wanted,
        channels: view.channels,
        campaigns: view.campaigns,
        ...(userPaused ? { userPaused } : {}),
        ...extras(),
        queue: queueView(queueOf())
      }
    },
    onChange(listener) {
      const offs = [
        miner.onChange(listener),
        inventory.onChange(listener),
        channels.onChange(listener),
        connectivity.onChange(listener),
        gameInfo.onChange(listener),
        ((): (() => void) => {
          extraListeners.add(listener)
          return () => extraListeners.delete(listener)
        })(),
        // Queue settings (order, sort, layout, rules) change the queue in the view.
        settings.subscribe(() => listener())
      ]
      return () => offs.forEach((off) => off())
    },
    reload: () => miner.reload(),
    selectChannel: (channelId) => miner.selectChannel(channelId),
    async searchGames(query) {
      const data = await gql.request(operations.SearchGames, { query, first: SEARCH_RESULTS })
      return (data.searchCategories?.edges ?? []).flatMap(({ node }) =>
        node
          ? [
              {
                id: node.id,
                // The same name campaigns use, so lists match either way.
                name: node.displayName ?? node.name ?? node.id,
                ...(node.boxArtURL ? { boxArtUrl: withoutImageSize(node.boxArtURL) } : {}),
                ...(node.slug ? { slug: node.slug } : {})
              }
            ]
          : []
      )
    },
    async stop() {
      offAuth()
      offConnectivity()
      offSettings()
      offInventory()
      offInventoryGames()
      clearInterval(gameInfoTimer)
      mining = false
      await miner.stop()
    }
  }
}
