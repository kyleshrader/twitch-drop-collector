import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { systemScheduler } from './runtime'

describe('systemScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settled = (promise: Promise<void>): (() => boolean) => {
    let done = false
    promise.then(
      () => (done = true),
      () => (done = true)
    )
    return () => done
  }

  it('resolves after the delay', async () => {
    const done = settled(systemScheduler.sleep(1_000))
    await vi.advanceTimersByTimeAsync(999)
    expect(done()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done()).toBe(true)
  })

  // Found live: setTimeout turns Infinity into 1ms, so an idle "wait forever" loop spun.
  it('never resolves an infinite wait, and sets no timer for it', async () => {
    const control = new AbortController()
    const sleep = systemScheduler.sleep(Number.POSITIVE_INFINITY, control.signal)
    const done = settled(sleep)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2 ** 32)
    expect(done()).toBe(false)
    control.abort()
    await expect(sleep).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('waits out delays longer than one timer allows', async () => {
    const done = settled(systemScheduler.sleep(30 * 86_400_000))
    await vi.advanceTimersByTimeAsync(29 * 86_400_000)
    expect(done()).toBe(false)
    await vi.advanceTimersByTimeAsync(86_400_000)
    expect(done()).toBe(true)
  })

  it('rejects at once when already aborted', async () => {
    await expect(systemScheduler.sleep(10, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
