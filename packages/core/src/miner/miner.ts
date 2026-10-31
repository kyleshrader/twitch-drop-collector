// The miner: keeps the inventory current, picks the best channel, watches it, follows live
// events and claims drops. A port of upstream's main loop (docs/port-plan.md §3), restructured:
// the miner's own actions run one at a time through a queue, every decision is a pure rule from
// ../domain, and the services do the I/O.
import { gql, pubsubTopics, type GqlClient, type RealtimeSource } from '@tdc/api'
import { AbortError, createEmitter, type Clock, type Logger, type Scheduler } from '@tdc/kernel'
import type { ChannelService } from '../channels/channel-service'
import { canEarnCampaign, canEarnDrop, firstEarnableDrop, type EarnContext } from '../domain/rules'
import {
  activeCampaign,
  canWatch,
  maintenanceTriggers,
  pickChannel,
  selectWantedGames,
  shouldSwitch
} from '../domain/selection'
import type { Campaign, Channel, Drop, Game, MiningPreferences, Stream } from '../domain/types'
import type { InventoryService } from '../inventory/inventory-service'
import type { WatchService } from '../watch/watch-service'
import { DropEvent, NotificationEvent, REWARD_NOTIFICATION_TYPES, StreamStateEvent } from './events'

export type MinerStatus = 'stopped' | 'loading' | 'idle' | 'watching' | 'error'

export interface MinerSnapshot {
  status: MinerStatus
  /** Why the miner is idle or in error. */
  message?: string
  watching?: Channel
  /** What watching is progressing right now. */
  active?: { campaign: Campaign; drop?: Drop }
  wanted: readonly Game[]
  /** The channel the user picked, while the pick stands (it's followed only when watchable). */
  selectedId?: string
}

export interface ClaimNotice {
  gameName: string
  dropName: string
  rewards: string[]
}

export interface Miner {
  start(): void
  stop(): Promise<void>
  /** Full reload: inventory, claims, games, channels. */
  reload(): void
  /** Re-pick games and channels with the current campaigns (e.g. after settings change). */
  refreshGames(): void
  /** Watch this channel while it's watchable (undefined: let the miner choose). */
  selectChannel(channelId: string | undefined): void
  snapshot(): MinerSnapshot
  onChange(listener: (snapshot: MinerSnapshot) => void): () => void
}

export interface MinerTiming {
  /** Stream-up events arrive before the stream is really up (upstream: 120s). */
  streamUpDelayMs: number
  /** After a claim, Twitch needs a moment before the next drop can start. */
  claimSettleMs: number
  claimPollMs: number
  claimPolls: number
  /** Without progress for this long, ask Twitch, then estimate. */
  progressStaleMs: number
  /** Full reload interval (upstream: hourly). */
  reloadEveryMs: number
  /** Wait before retrying a failed reload. */
  retryAfterMs: number
}

export const DEFAULT_TIMING: MinerTiming = {
  streamUpDelayMs: 120_000,
  claimSettleMs: 4_000,
  claimPollMs: 2_000,
  claimPolls: 8,
  progressStaleMs: 60_000,
  reloadEveryMs: 60 * 60 * 1000,
  retryAfterMs: 5 * 60 * 1000
}

export function createMiner(deps: {
  inventory: InventoryService
  channels: ChannelService
  watch: WatchService
  realtime: RealtimeSource
  gql: GqlClient
  userId: () => string
  preferences: () => MiningPreferences
  clock: Clock
  scheduler: Scheduler
  logger: Logger
  onClaim?: (notice: ClaimNotice) => void
  timing?: Partial<MinerTiming>
}): Miner {
  const { inventory, channels, watch, realtime, clock, scheduler, logger } = deps
  const timing = { ...DEFAULT_TIMING, ...deps.timing }
  const events = createEmitter<{ change: MinerSnapshot }>({
    onListenerError: (error) => logger.error('Miner listener failed', { error })
  })

  let status: MinerStatus = 'stopped'
  let message: string | undefined
  let wanted: readonly Game[] = []
  let selectedId: string | undefined
  let lastProgressAt = 0
  let running: AbortController | undefined
  let maintenance: AbortController | undefined
  const pendingOnline = new Map<string, AbortController>()
  const channelTopics = new Map<string, () => void>()
  const unsubscribeUser: (() => void)[] = []

  const ctx = (): EarnContext => ({ now: clock.now(), preferences: deps.preferences() })
  const watching = (): Channel | undefined => {
    const current = watch.watching()
    return current ? (channels.get(current.id) ?? current) : undefined
  }

  const snapshot = (): MinerSnapshot => {
    const channel = watching()
    const context = ctx()
    const campaign = channel
      ? activeCampaign(channel, inventory.campaigns(), wanted, context)
      : undefined
    const drop = campaign ? firstEarnableDrop(campaign, context, channel) : undefined
    return {
      status,
      ...(message ? { message } : {}),
      ...(channel ? { watching: channel } : {}),
      ...(campaign ? { active: { campaign, ...(drop ? { drop } : {}) } } : {}),
      wanted,
      ...(selectedId ? { selectedId } : {})
    }
  }
  const publish = (): void => events.emit('change', snapshot())
  const setStatus = (next: MinerStatus, why?: string): void => {
    status = next
    message = why
    publish()
  }

  // The miner's own actions run one at a time, in order.
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (name: string, task: () => Promise<void>): void => {
    queue = queue.then(async () => {
      if (!running) return
      try {
        await task()
      } catch (error) {
        if (error instanceof AbortError || !running) return
        logger.error(`Miner task failed: ${name}`, { error })
        setStatus('error', error instanceof Error ? error.message : String(error))
        scheduleRetry()
      }
    })
  }

  /** Sleeps unless the miner stops (or `extra` aborts). False when cut short. */
  const sleep = async (ms: number, extra?: AbortSignal): Promise<boolean> => {
    if (!running) return false
    const signal = extra ? AbortSignal.any([running.signal, extra]) : running.signal
    try {
      await scheduler.sleep(ms, signal)
      return true
    } catch {
      return false
    }
  }

  // ---- choosing what to watch ---------------------------------------------------------------

  const switchChannel = (): void => {
    const current = watching()
    const selected = selectedId ? channels.get(selectedId) : undefined
    const pick = pickChannel({
      channels: channels.channels(),
      ...(current ? { watching: current } : {}),
      ...(selected ? { selected } : {}),
      campaigns: inventory.campaigns(),
      wanted,
      ctx: ctx()
    })
    if (pick.channel) {
      if (pick.channel.id !== current?.id) lastProgressAt = clock.now().getTime()
      watch.watch(pick.channel)
      setStatus('watching')
    } else {
      watch.watch(undefined)
      setStatus(
        'idle',
        wanted.length === 0 ? 'No campaigns to mine right now' : 'No channel to watch right now'
      )
    }
  }

  const syncChannelTopics = (): void => {
    const desired = new Map<string, string>()
    for (const c of channels.channels()) {
      desired.set(pubsubTopics.channelStreamState(c.id), c.id)
      desired.set(pubsubTopics.channelSettingsUpdate(c.id), c.id)
    }
    for (const [topic, off] of channelTopics) {
      if (!desired.has(topic)) {
        off()
        channelTopics.delete(topic)
      }
    }
    for (const [topic, channelId] of desired) {
      if (channelTopics.has(topic)) continue
      const handler = topic.startsWith('video-playback-by-id.')
        ? (payload: unknown) => onStreamState(channelId, payload)
        : () => checkOnlineLater(channelId)
      channelTopics.set(topic, realtime.subscribe(topic, handler))
    }
  }

  const scheduleMaintenance = (): void => {
    maintenance?.abort()
    const control = new AbortController()
    maintenance = control
    const now = clock.now().getTime()
    // Campaign or drop windows opening or closing within the hour: re-pick channels then.
    for (const at of maintenanceTriggers(inventory.campaigns(), ctx())) {
      void sleep(at.getTime() - now, control.signal).then((due) => {
        if (due) enqueue('maintenance', gamesUpdate)
      })
    }
    void sleep(timing.reloadEveryMs, control.signal).then((due) => {
      if (due) enqueue('hourly reload', reloadTask)
    })
  }

  const scheduleRetry = (): void => {
    maintenance?.abort()
    const control = new AbortController()
    maintenance = control
    void sleep(timing.retryAfterMs, control.signal).then((due) => {
      if (due) enqueue('retry reload', reloadTask)
    })
  }

  const gamesUpdate = async (): Promise<void> => {
    const campaigns = inventory.campaigns()
    wanted = selectWantedGames(campaigns, deps.preferences(), clock.now())
    await channels.refresh({ campaigns, wanted, ctx: ctx() }, running?.signal)
    syncChannelTopics()
    switchChannel()
    scheduleMaintenance()
  }

  const reloadTask = async (): Promise<void> => {
    setStatus('loading')
    await inventory.refresh(running?.signal)
    for (const drop of await inventory.claimAll(running?.signal)) announceClaim(drop.id)
    await gamesUpdate()
  }

  // ---- live events ---------------------------------------------------------------------------

  /** A channel's stream changed (from `before` to `after`): switch if it matters. */
  const channelUpdated = (channelId: string): void => {
    const channel = channels.get(channelId)
    const current = watching()
    if (!channel) return
    const campaigns = inventory.campaigns()
    if (current?.id === channelId && !canWatch(channel, campaigns, wanted, ctx())) {
      logger.info('Watched channel no longer qualifies; switching', { channel: channel.login })
      switchChannel()
    } else if (shouldSwitch(channel, current, campaigns, wanted, ctx())) {
      switchChannel()
    } else {
      publish()
    }
  }

  /** Stream-up and settings changes are confirmed after a delay, as upstream. */
  const checkOnlineLater = (channelId: string): void => {
    if (pendingOnline.has(channelId)) return
    const control = new AbortController()
    pendingOnline.set(channelId, control)
    void sleep(timing.streamUpDelayMs, control.signal).then((due) => {
      pendingOnline.delete(channelId)
      if (!due) return
      enqueue('stream check', async () => {
        await channels.updateStream(
          channelId,
          { campaigns: inventory.campaigns(), ctx: ctx() },
          running?.signal
        )
        channelUpdated(channelId)
      })
    })
  }

  const onStreamState = (channelId: string, payload: unknown): void => {
    const parsed = StreamStateEvent.safeParse(payload)
    if (!parsed.success) return
    const { type, viewers } = parsed.data
    if (type === 'viewcount') {
      if (!channels.get(channelId)?.stream) checkOnlineLater(channelId)
      else if (viewers !== undefined) channels.setViewers(channelId, viewers)
    } else if (type === 'stream-down') {
      pendingOnline.get(channelId)?.abort()
      pendingOnline.delete(channelId)
      const before: Stream | undefined = channels.setOffline(channelId)
      if (before) channelUpdated(channelId)
    } else if (type === 'stream-up') {
      checkOnlineLater(channelId)
    }
  }

  const announceClaim = (dropId: string): void => {
    const found = inventory.find(dropId)
    if (!found) return
    deps.onClaim?.({
      gameName: found.campaign.game.name,
      dropName: found.drop.name,
      rewards: found.drop.benefits.map((b) => b.name)
    })
  }

  const claimFlow = async (dropId: string, claimId: string): Promise<void> => {
    inventory.setClaimId(dropId, claimId)
    if (await inventory.claim(dropId, running?.signal)) announceClaim(dropId)
    // The next drop can start once Twitch moves the session off the claimed drop.
    if (!(await sleep(timing.claimSettleMs))) return
    const channel = watching()
    if (channel) {
      for (let i = 0; i < timing.claimPolls; i++) {
        const { currentUser } = await deps.gql.request(
          gql.CurrentDrop,
          { channelId: channel.id },
          running?.signal
        )
        const session = currentUser.dropCurrentSession
        if (!session || session.dropID !== dropId) break
        if (!(await sleep(timing.claimPollMs))) return
      }
    }
    const campaign = inventory.find(dropId)?.campaign
    if (channel && campaign && canEarnCampaign(campaign, ctx(), channel)) {
      lastProgressAt = clock.now().getTime()
      watch.restart()
      publish()
    } else {
      await reloadTask()
    }
  }

  const onDropEvent = (payload: unknown): void => {
    const parsed = DropEvent.safeParse(payload)
    if (!parsed.success) return
    const event = parsed.data
    if (event.type === 'drop-claim') {
      enqueue('claim', () => claimFlow(event.data.drop_id, event.data.drop_instance_id))
      return
    }
    const found = inventory.find(event.data.drop_id)
    const channel = watching()
    if (
      found &&
      canEarnDrop(found.drop, found.campaign, clock.now()) &&
      canEarnCampaign(found.campaign, ctx(), channel)
    ) {
      inventory.updateDropMinutes(event.data.drop_id, event.data.current_progress_min)
      lastProgressAt = clock.now().getTime()
      logger.debug('Progress from Twitch', {
        drop: found.drop.name,
        minutes: event.data.current_progress_min
      })
      publish()
    }
  }

  const onNotification = (payload: unknown): void => {
    const parsed = NotificationEvent.safeParse(payload)
    const notification = parsed.success ? parsed.data.data?.notification : undefined
    if (parsed.data?.type !== 'create-notification' || !notification) return
    if (!REWARD_NOTIFICATION_TYPES.has(notification.type)) return
    enqueue('reward notification', async () => {
      await deps.gql
        .request(gql.DeleteNotification, { notificationId: notification.id }, running?.signal)
        .catch((error: unknown) => logger.warn('Could not dismiss a notification', { error }))
      await reloadTask()
    })
  }

  /** ~15s after each watch: if Twitch has gone quiet, ask it, else estimate a minute. */
  const onProgressCheck = (channel: Channel): void => {
    if (clock.now().getTime() - lastProgressAt < timing.progressStaleMs) return
    enqueue('progress check', async () => {
      const { currentUser } = await deps.gql.request(
        gql.CurrentDrop,
        { channelId: channel.id },
        running?.signal
      )
      const session = currentUser.dropCurrentSession
      const found = session?.dropID ? inventory.find(session.dropID) : undefined
      if (session && found && canEarnCampaign(found.campaign, ctx(), channel)) {
        inventory.updateDropMinutes(session.dropID, session.currentMinutesWatched)
        lastProgressAt = clock.now().getTime()
        logger.debug('Progress from the current-drop query', {
          drop: found.drop.name,
          minutes: session.currentMinutesWatched
        })
        publish()
        return
      }
      const campaign = activeCampaign(channel, inventory.campaigns(), wanted, ctx())
      if (!campaign) return
      const { reachedCap } = inventory.bumpEstimatedMinutes(campaign.id, ctx(), channel)
      lastProgressAt = clock.now().getTime()
      logger.debug('No progress from Twitch; estimated a minute', { campaign: campaign.name })
      if (reachedCap) {
        logger.warn('Twitch stopped reporting progress for too long; switching', {
          channel: channel.login
        })
        switchChannel()
      } else {
        publish()
      }
    })
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  return {
    start() {
      if (running) return
      running = new AbortController()
      const userId = deps.userId()
      unsubscribeUser.push(
        realtime.subscribe(pubsubTopics.userDrops(userId), onDropEvent),
        realtime.subscribe(pubsubTopics.userNotifications(userId), onNotification),
        watch.onProgressCheck(onProgressCheck),
        watch.onTick((tick) => {
          if (tick.ok) return
          enqueue('watch failed', async () => {
            await channels.updateStream(
              tick.channel.id,
              { campaigns: inventory.campaigns(), ctx: ctx() },
              running?.signal
            )
            channelUpdated(tick.channel.id)
          })
        })
      )
      realtime.start()
      watch.start()
      enqueue('reload', reloadTask)
    },

    async stop() {
      if (!running) return
      running.abort()
      running = undefined
      maintenance?.abort()
      for (const control of pendingOnline.values()) control.abort()
      pendingOnline.clear()
      for (const off of [...unsubscribeUser.splice(0), ...channelTopics.values()]) off()
      channelTopics.clear()
      watch.watch(undefined)
      await Promise.all([watch.stop(), realtime.stop(), queue])
      setStatus('stopped')
    },

    reload: () => enqueue('reload', reloadTask),
    refreshGames: () => enqueue('games update', gamesUpdate),
    selectChannel(channelId) {
      selectedId = channelId
      publish()
      enqueue('select channel', async () => {
        switchChannel()
        const picked = channelId ? channels.get(channelId) : undefined
        if (picked && watching()?.id !== picked.id) {
          logger.info('The picked channel would progress nothing; not switching', {
            channel: picked.login
          })
        }
      })
    },
    snapshot,
    onChange: (listener) => events.on('change', listener)
  }
}
