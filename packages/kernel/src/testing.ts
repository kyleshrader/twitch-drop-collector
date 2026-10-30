// Test helpers: a clock and scheduler that only move when the test says so.
import type { Clock } from './clock'
import { AbortError, type AbortSignalLike, type Scheduler } from './scheduler'

interface Timer {
  at: number
  resolve: () => void
}

/** Lets pending promise callbacks run. */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

export interface ManualTime {
  clock: Clock
  scheduler: Scheduler
  /** Moves time forward, firing every timer due on the way, in order. */
  advance(ms: number): Promise<void>
  /** Number of sleeps still waiting. */
  readonly pending: number
}

export function createManualTime(start = Date.parse('2026-10-30T12:00:00.000Z')): ManualTime {
  let now = start
  const timers: Timer[] = []

  const scheduler: Scheduler = {
    sleep(ms: number, signal?: AbortSignalLike) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortError())
        const onAbort = (): void => {
          const index = timers.indexOf(timer)
          if (index >= 0) timers.splice(index, 1)
          reject(new AbortError())
        }
        const timer: Timer = {
          at: now + Math.max(0, ms),
          resolve: () => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }
        }
        timers.push(timer)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }

  return {
    clock: { now: () => new Date(now) },
    scheduler,
    async advance(ms) {
      const target = now + ms
      await flushMicrotasks()
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (!next || next.at > target) break
        timers.shift()
        now = next.at
        next.resolve()
        await flushMicrotasks()
      }
      now = target
      await flushMicrotasks()
    },
    get pending() {
      return timers.length
    }
  }
}
