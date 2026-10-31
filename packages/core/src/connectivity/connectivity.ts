// Whether mining can run right now: online and not asleep (docs/port-plan.md §4). The host
// supplies an online check and power events; this decides when the state changes.
import { createEmitter, type Logger, type Scheduler } from '@tdc/kernel'

export type ConnectivityState = 'online' | 'offline' | 'asleep'

export interface PowerEvents {
  on(event: 'suspend' | 'resume', listener: () => void): () => void
}

export interface Connectivity {
  state(): ConnectivityState
  onChange(listener: (state: ConnectivityState) => void): () => void
  start(): void
  stop(): void
}

export const ONLINE_CHECK_MS = 5_000

export function createConnectivity(deps: {
  /** False is reliable; true only means "maybe" (Electron's net.isOnline). */
  isOnline: () => boolean
  power: PowerEvents
  scheduler: Scheduler
  logger: Logger
  checkEveryMs?: number
}): Connectivity {
  const { isOnline, power, scheduler, logger, checkEveryMs = ONLINE_CHECK_MS } = deps
  const events = createEmitter<{ change: ConnectivityState }>({
    onListenerError: (error) => logger.error('Connectivity listener failed', { error })
  })
  let asleep = false
  let current: ConnectivityState = 'online'
  let running: AbortController | undefined
  let offPower: (() => void)[] = []

  const update = (): void => {
    const next: ConnectivityState = asleep ? 'asleep' : isOnline() ? 'online' : 'offline'
    if (next === current) return
    logger.info('Connectivity changed', { from: current, to: next })
    current = next
    events.emit('change', next)
  }

  const poll = async (signal: AbortSignal): Promise<void> => {
    while (!signal.aborted) {
      try {
        await scheduler.sleep(checkEveryMs, signal)
      } catch {
        return
      }
      update()
    }
  }

  return {
    state: () => current,
    onChange: (listener) => events.on('change', listener),
    start() {
      if (running) return
      running = new AbortController()
      offPower = [
        power.on('suspend', () => {
          asleep = true
          update()
        }),
        power.on('resume', () => {
          asleep = false
          update()
        })
      ]
      update()
      void poll(running.signal)
    },
    stop() {
      running?.abort()
      running = undefined
      offPower.forEach((off) => off())
      offPower = []
    }
  }
}
