// Host implementations of kernel interfaces, for code running on Node or Electron.
import { AbortError, type Scheduler } from '@tdc/kernel'

export const systemScheduler: Scheduler = {
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortError())
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new AbortError())
      }
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        },
        Math.max(0, ms)
      )
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
