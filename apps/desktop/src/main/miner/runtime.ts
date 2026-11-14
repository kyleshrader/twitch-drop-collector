// Builds the miner and everything it needs, and runs it while the user is signed in.
import {
  createGqlClient,
  createHlsWatcher,
  gql as operations,
  createPubSub,
  systemScheduler,
  type ApiMonitor,
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
  hasBadgeOrEmote,
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
import type { CampaignView, GameSearchResult, HistoryView, MinerView } from '@tdc/ipc-contract'
import type { Storage } from '@tdc/storage'
import { buildHistory } from '../history/history'
import { createGameInfoService } from './game-info'
import { pastCampaigns, snapshotOf } from './past-campaigns'
import { campaignView, queueView, toMinerView, withGameInfo, type ViewHistory } from './views'

/** How many games a search returns. */
const SEARCH_RESULTS = 12
/** Watching is counted for the History page a minute at a time. */
const WATCH_TICK_MS = 60_000
/** Campaign copies are saved when campaigns or claims change, and at least this often. */
const SNAPSHOT_EVERY_MS = 10 * 60_000
/** The History page lists at most this many claims. */
const MAX_HISTORY_CLAIMS = 5000
/** How often saved game info is checked for games due a look-up (game-info.ts says when). */
const GAME_INFO_REFRESH_MS = 6 * 60 * 60 * 1000

export interface ApiCallOutcome {
  endpoint: string
  ok: boolean
  ms: number
  error?: string
  response?: unknown
}

export interface MiningRuntime {
  view(): MinerView
  /** Called (throttled by the caller) whenever anything in the view may have changed. */
  onChange(listener: () => void): () => void
  reload(): void
  selectChannel(channelId: string | undefined): void
  /** Twitch games whose name matches, best match first. */
  searchGames(query: string): Promise<GameSearchResult[]>
  /** The read-only Twitch requests checkApi can run, by endpoint name. */
  apiCalls(): string[]
  /** Runs those requests (or just `only`); the monitor records any mismatch. Not redacted. */
  checkApi(only?: string): Promise<ApiCallOutcome[]>
  /** The History page's timeline, from the local database. */
  history(): HistoryView
  /** Campaigns Twitch no longer lists, as last saved, for the Library. */
  pastCampaigns(): CampaignView[]
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
  /** Told about responses that suggest Twitch changed its API. */
  monitor?: ApiMonitor
  /** How often watching is counted for the History page (end-to-end tests shorten it). */
  watchTickMs?: number
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
    logger: logger.child('gql'),
    monitor: deps.monitor
  })
  const realtime = createPubSub({
    url: endpoints.pubsub,
    connect: deps.connect,
    accessToken: () => auth.accessToken(),
    scheduler,
    logger: logger.child('pubsub'),
    monitor: deps.monitor
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
  // The Up next queue (docs/new-ui/queue-rules.md): it ranks what the miner watches.
  const queueOf = (current?: Campaign): Queue => {
    return buildQueue({
      campaigns: inventory.campaigns(),
      preferences: settings.get().mining,
      options: queueOptions(settings.get().queue),
      ctx: { now: clock.now(), preferences: settings.get().mining },
      ...(current ? { current } : {})
    })
  }
  // The app's own history: when campaigns were first seen and how each stands (recorded as the
  // inventory loads, for the History page to tell completed from missed once they end), and when
  // drops were claimed, including Twitch's award time for drops claimed elsewhere. Read back for
  // the view only after something changed.
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
    const changed = fresh.length > 0 || claimed !== claimedCount
    if (changed) {
      try {
        recordStandings(list)
      } catch (error) {
        logger.warn('Saving the history failed', { error })
      }
      history = undefined
    }
    claimedCount = claimed
    // A full copy of every campaign, so one Twitch stops listing can still be shown. Progress
    // alone changes it every minute; saving that every ten minutes is enough.
    if (changed || clock.now().getTime() - snapshotAt >= SNAPSHOT_EVERY_MS) saveSnapshots(list)
  }
  let snapshotAt = 0
  const saveSnapshots = (list: readonly Campaign[]): void => {
    const now = clock.now()
    try {
      const views = withGameInfo(
        list.map((c) => campaignView(c, now, historyNow())),
        gameInfo.known()
      )
      storage.snapshots.save(views.map(snapshotOf), now)
      snapshotAt = now.getTime()
    } catch (error) {
      logger.warn('Saving campaign copies failed', { error })
    }
  }
  /** Writes to the History page's event log; never in the way of anything else. */
  const recordEvent = (kind: string, data: Record<string, unknown> = {}): void => {
    try {
      storage.events.record(kind, data, clock.now())
    } catch (error) {
      logger.warn('Saving the history failed', { error, kind })
    }
  }
  const recordStandings = (list: readonly Campaign[]): void => {
    const { enableBadgesEmotes } = settings.get().mining
    // A game whose campaigns needed a linked account last time and don't now was just linked.
    const couldEarn = new Map(
      storage.seen.all().flatMap((s) => (s.standing ? [[s.id, s.standing.earnable]] : []))
    )
    const linked = new Set(
      list
        .filter((c) => !hasBadgeOrEmote(c) && c.linked && couldEarn.get(c.id) === false)
        .map((c) => c.game.name)
    )
    for (const game of linked) recordEvent('linked', { game })
    storage.seen.updateStandings(
      list.map((c) => ({
        id: c.id,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        dropsTotal: c.drops.length,
        dropsClaimed: c.drops.filter((d) => d.claimed).length,
        earnable: hasBadgeOrEmote(c) ? enableBadgesEmotes : c.linked
      })),
      clock.now()
    )
    for (const c of list) {
      for (const d of c.drops) {
        if (!d.claimed || !d.awardedAt) continue
        storage.claims.record({
          dropId: d.id,
          campaignId: c.id,
          gameName: c.game.name,
          dropName: d.name,
          rewards: d.benefits.map((b) => b.name),
          claimedAt: d.awardedAt,
          ...(d.benefits[0]?.imageUrl ? { imageUrl: d.benefits[0].imageUrl } : {}),
          source: 'twitch'
        })
      }
    }
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
    // Paused means no Twitch traffic at all, these look-ups included.
    if (auth.state().status === 'signedIn' && !settings.get().queue.paused) {
      void gameInfo.refresh(gameNames())
    }
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

  /** Counts the last minute of watching, while the miner is watching something. */
  const watchTick = deps.watchTickMs ?? WATCH_TICK_MS
  const countWatching = (): void => {
    if (!mining || paused() !== undefined) return
    const snapshot = miner.snapshot()
    const channel = snapshot.watching
    if (!channel) return
    const campaign = snapshot.active?.campaign
    const game = campaign?.game.name ?? channel.stream?.game?.name
    if (!game) return
    try {
      storage.watched.count(
        {
          channelLogin: channel.login,
          channelName: channel.displayName ?? channel.login,
          gameName: game,
          ...(campaign ? { campaignId: campaign.id, campaignName: campaign.name } : {})
        },
        clock.now(),
        watchTick,
        // Minutes join one session across a missed tick or two.
        3 * watchTick
      )
    } catch (error) {
      logger.warn('Saving what was watched failed', { error })
    }
  }
  const watchTimer = setInterval(countWatching, watchTick)
  watchTimer.unref?.()

  /** Channels are ranked by the Up next queue (docs/new-ui/queue-rules.md). */
  const queueRank = (): CampaignRank => queueOf().rank

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
    onClaim: deps.onClaim,
    monitor: deps.monitor
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

  /** What of the settings ranks channels: the queue (all but pausing). */
  const queueDrives = (s: Settings): string => JSON.stringify({ ...s.queue, paused: undefined })
  const offSettings = settings.subscribe((next, previous) => {
    if (next.queue.paused !== previous.queue.paused) {
      recordEvent(next.queue.paused ? 'paused' : 'resumed')
      follow(auth.state())
    }
    // List changes, for the History page: where each changed game ended up.
    const listOf = (s: Settings, game: string): string =>
      s.mining.priority.includes(game)
        ? 'priority'
        : s.mining.exclude.includes(game)
          ? 'excluded'
          : 'notSet'
    const games = new Set([
      ...next.mining.priority,
      ...next.mining.exclude,
      ...previous.mining.priority,
      ...previous.mining.exclude
    ])
    for (const game of games) {
      const list = listOf(next, game)
      if (list !== listOf(previous, game)) recordEvent('list', { game, list })
    }
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

  /**
   * The read-only requests the Twitch API page can run, by endpoint name. Nothing here claims,
   * watches or changes anything on Twitch. Some need a campaign or a channel to ask about.
   */
  const apiCalls = (): [string, () => Promise<unknown>][] => {
    const state = auth.state()
    if (state.status !== 'signedIn') return []
    const id = state.user.id
    const campaign = inventory.campaigns()[0]
    const channel = channels.channels().find((c) => c.stream) ?? channels.channels()[0]
    const slug = campaign
      ? (campaign.game.slug ?? gameInfo.known()[campaign.game.name]?.slug)
      : undefined
    const calls: [string, () => Promise<unknown>][] = [
      [operations.Inventory.name, () => gql.request(operations.Inventory, undefined)],
      [operations.Campaigns.name, () => gql.request(operations.Campaigns, undefined)],
      [
        operations.SearchGames.name,
        () => gql.request(operations.SearchGames, { query: 'minecraft', first: 1 })
      ],
      [operations.UserAvatar.name, () => gql.request(operations.UserAvatar, { userId: id })]
    ]
    if (campaign) {
      calls.push(
        [
          operations.CampaignDetailsQuery.name,
          () =>
            gql.request(operations.CampaignDetailsQuery, { campaignId: campaign.id, userId: id })
        ],
        [
          operations.GameByName.name,
          () => gql.request(operations.GameByName, { name: campaign.game.name })
        ]
      )
    }
    if (slug) {
      calls.push([
        operations.GameDirectory.name,
        () => gql.request(operations.GameDirectory, { slug, limit: 1, dropsEnabledOnly: true })
      ])
    }
    if (channel) {
      calls.push(
        [
          operations.StreamInfo.name,
          () => gql.request(operations.StreamInfo, { login: channel.login })
        ],
        [
          operations.AvailableDrops.name,
          () => gql.request(operations.AvailableDrops, { channelId: channel.id })
        ]
      )
    }
    return calls
  }

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
    apiCalls: () => apiCalls().map(([endpoint]) => endpoint),
    async checkApi(only) {
      const calls = apiCalls().filter(([endpoint]) => only === undefined || endpoint === only)
      return Promise.all(
        calls.map(async ([endpoint, run]) => {
          const started = performance.now()
          const ms = (): number => Math.round(performance.now() - started)
          try {
            const response = await run()
            return { endpoint, ok: true, ms: ms(), response }
          } catch (error) {
            logger.warn('API check failed', { endpoint, error })
            return { endpoint, ok: false, ms: ms(), error: String(error) }
          }
        })
      )
    },
    pastCampaigns: () =>
      withGameInfo(
        pastCampaigns(storage.snapshots.all(), new Set(inventory.campaigns().map((c) => c.id))),
        gameInfo.known()
      ),
    history: () =>
      buildHistory({
        claims: storage.claims.recent(MAX_HISTORY_CLAIMS),
        seen: storage.seen.all(),
        sessions: storage.watched.since(new Date(0)),
        events: storage.events.all(),
        now: clock.now()
      }),
    async stop() {
      clearInterval(watchTimer)
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
