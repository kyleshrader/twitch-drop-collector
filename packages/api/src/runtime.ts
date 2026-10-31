// Host implementations of kernel interfaces, for code running on Node or Electron.
import { AbortError, type Scheduler } from '@tdc/kernel'

/** setTimeout's longest delay; longer ones (Infinity included) fire after 1ms instead. */
const MAX_TIMER_MS = 2 ** 31 - 1

export const systemScheduler: Scheduler = {
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortError())
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new AbortError())
      }
      const dueAt = Date.now() + Math.max(0, ms)
      // Infinity never fires; it only ends by abort. Long delays run as a chain of timers.
      const arm = (): void => {
        const left = dueAt - Date.now()
        if (left === Number.POSITIVE_INFINITY) return
        timer = setTimeout(
          () => {
            if (left > MAX_TIMER_MS) return arm()
            signal?.removeEventListener('abort', onAbort)
            resolve()
          },
          Math.min(Math.max(0, left), MAX_TIMER_MS)
        )
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      arm()
    })
  }
}
