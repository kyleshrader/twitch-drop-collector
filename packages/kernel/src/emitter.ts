/** Minimal typed event emitter. Listeners run synchronously, in subscription order. */
export interface Emitter<Events extends Record<string, unknown>> {
  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void
  emit<E extends keyof Events>(event: E, payload: Events[E]): void
}

export function createEmitter<Events extends Record<string, unknown>>(options?: {
  /** Called when a listener throws; the remaining listeners still run. */
  onListenerError?: (error: unknown, event: keyof Events) => void
}): Emitter<Events> {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>()
  return {
    on(event, listener) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(listener)
      return () => set.delete(listener)
    },
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        try {
          ;(listener as (payload: Events[typeof event]) => void)(payload)
        } catch (error) {
          options?.onListenerError?.(error, event)
        }
      }
    }
  }
}
