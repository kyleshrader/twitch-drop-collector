/** Structural subset of AbortSignal, so kernel needs no DOM or Node types. */
export interface AbortSignalLike {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** Waiting, injected so time-based code is testable. The timer-based one lives in @tdc/api. */
export interface Scheduler {
  /** Resolves after ms, or rejects with AbortError as soon as signal aborts. */
  sleep(ms: number, signal?: AbortSignalLike): Promise<void>
}

export class AbortError extends Error {
  constructor(message = 'The operation was aborted') {
    super(message)
    this.name = 'AbortError'
  }
}
