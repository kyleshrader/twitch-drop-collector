// At most `capacity` tasks may start in any `windowMs` window, and at most `capacity` may run
// at once. Waiting tasks start in the order they asked (FIFO).
import type { Clock } from './clock'
import type { Scheduler } from './scheduler'

export interface RateLimiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createRateLimiter(options: {
  capacity: number
  windowMs: number
  clock: Clock
  scheduler: Scheduler
}): RateLimiter {
  const { capacity, windowMs, clock, scheduler } = options
  if (!(capacity >= 1)) throw new RangeError('capacity must be at least 1')

  const starts: number[] = []
  const queue: (() => void)[] = []
  let running = 0
  let timerPending = false

  const pump = (): void => {
    while (queue.length > 0) {
      const now = clock.now().getTime()
      while (starts.length > 0 && starts[0]! <= now - windowMs) starts.shift()
      if (running >= capacity) return // a finishing task calls pump again
      if (starts.length >= capacity) {
        if (!timerPending) {
          timerPending = true
          void scheduler.sleep(starts[0]! + windowMs - now).then(() => {
            timerPending = false
            pump()
          })
        }
        return
      }
      starts.push(now)
      running++
      queue.shift()!()
    }
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push(() => {
          task()
            .then(resolve, reject)
            .finally(() => {
              running--
              pump()
            })
        })
        pump()
      })
    }
  }
}
