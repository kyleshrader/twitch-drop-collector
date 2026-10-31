// Main → renderer events: validated against the contract, then sent to the app window.
import { eventChannels, type EventChannel, type EventPayload } from '@tdc/ipc-contract'
import type { Logger } from '@tdc/kernel'

export interface EventTarget {
  send(channel: string, payload: unknown): void
}

export interface EventPublisher {
  publish<E extends EventChannel>(event: E, payload: EventPayload<E>): void
}

export function createEventPublisher(deps: {
  /** The app window's webContents, if it's open. */
  target: () => EventTarget | undefined
  logger: Logger
}): EventPublisher {
  const { target, logger } = deps
  return {
    publish(event, payload) {
      const parsed = eventChannels[event].safeParse(payload)
      if (!parsed.success) {
        logger.error('Refusing to send an event that breaks the contract', {
          event,
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        })
        return
      }
      target()?.send(event, parsed.data)
    }
  }
}

/** Coalesces bursts (e.g. viewer counts) into at most one call per `ms`, with the latest state. */
export function throttle(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      fn()
    }, ms)
  }
}
