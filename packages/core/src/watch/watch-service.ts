// The watch loop: one watch about every 20s on the target channel, and a progress check ~15s
// after each, when Twitch should have reported progress (docs/port-plan.md §3).
import type { StreamWatcher } from '@tdc/api'
import { AbortError, createEmitter, type Clock, type Logger, type Scheduler } from '@tdc/kernel'
import type { Channel } from '../domain/types'

export const WATCH_INTERVAL_MS = 20_000
export const PROGRESS_CHECK_AFTER_MS = 15_000

export interface WatchTick {
  channel: Channel
  ok: boolean
  at: Date
}

export interface WatchService {
  watching(): Channel | undefined
  /** Watch `channel` from now on (undefined stops watching). Restarts the cycle. */
  watch(channel: Channel | undefined): void
  /** Send a watch right away, e.g. after a claim so the next drop starts. */
  restart(): void
  start(): void
  stop(): Promise<void>
  onTick(listener: (tick: WatchTick) => void): () => void
  /** ~15s after each watch: time to check whether Twitch reported progress. */
  onProgressCheck(listener: (channel: Channel) => void): () => void
}

export function createWatchService(deps: {
  watcher: StreamWatcher
  scheduler: Scheduler
  clock: Clock
  logger: Logger
  intervalMs?: number
  checkAfterMs?: number
}): WatchService {
  const {
    watcher,
    scheduler,
    clock,
    logger,
    intervalMs = WATCH_INTERVAL_MS,
    checkAfterMs = PROGRESS_CHECK_AFTER_MS
  } = deps
  const events = createEmitter<{ tick: WatchTick; check: Channel }>({
    onListenerError: (error) => logger.error('Watch listener failed', { error })
  })
  let target: Channel | undefined
  let running: AbortController | undefined
  /** Aborted to cut the current wait short (new target or restart). */
  let wake = new AbortController()
  let loop: Promise<void> | undefined

  const interrupt = (): void => {
    wake.abort()
    wake = new AbortController()
  }

  /** Sleeps until `ms` passes, the cycle is interrupted, or the service stops. */
  const pause = async (ms: number, stop: AbortSignal): Promise<boolean> => {
    try {
      await scheduler.sleep(Math.max(0, ms), AbortSignal.any([stop, wake.signal]))
      return true
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return false
      throw error
    }
  }

  const run = async (stop: AbortSignal): Promise<void> => {
    while (!stop.aborted) {
      const channel = target
      if (!channel) {
        await pause(Number.POSITIVE_INFINITY, stop)
        continue
      }
      const sentAt = clock.now().getTime()
      let ok = false
      try {
        ok = await watcher.watch(channel.login, stop)
      } catch (error) {
        if (stop.aborted || error instanceof AbortError) return
        logger.warn('Watch request failed', { channel: channel.login, error })
      }
      events.emit('tick', { channel, ok, at: new Date(sentAt) })

      const elapsed = (): number => clock.now().getTime() - sentAt
      if (!(await pause(checkAfterMs - elapsed(), stop))) continue
      if (target === channel) events.emit('check', channel)
      await pause(intervalMs - elapsed(), stop)
    }
  }

  return {
    watching: () => target,
    watch(channel) {
      if (channel?.id === target?.id && channel?.login === target?.login) {
        target = channel
        return
      }
      target = channel
      if (channel) logger.info('Watching', { channel: channel.login })
      interrupt()
    },
    restart: interrupt,
    start() {
      if (running) return
      running = new AbortController()
      loop = run(running.signal)
    },
    async stop() {
      running?.abort()
      running = undefined
      await loop
      loop = undefined
    },
    onTick: (listener) => events.on('tick', listener),
    onProgressCheck: (listener) => events.on('check', listener)
  }
}
