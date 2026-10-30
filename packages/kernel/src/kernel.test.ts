import { describe, expect, it, vi } from 'vitest'
import { createBackoff } from './backoff'
import { createEmitter } from './emitter'
import { createRateLimiter } from './rate-limiter'
import { AbortError } from './scheduler'
import { createManualTime } from './testing'

describe('backoff', () => {
  it('doubles from the initial delay up to the cap', () => {
    const backoff = createBackoff({ initialMs: 1000, maxMs: 10_000, random: () => 0.5 })
    expect([1, 2, 3, 4, 5, 6].map(() => backoff.next())).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000
    ])
    backoff.reset()
    expect(backoff.next()).toBe(1000)
  })

  it('varies each delay by the jitter fraction', () => {
    expect(createBackoff({ maxMs: 1e9, jitter: 0.1, random: () => 0 }).next()).toBe(900)
    expect(createBackoff({ maxMs: 1e9, jitter: 0.1, random: () => 1 }).next()).toBe(1100)
  })

  it('stops counting attempts once capped', () => {
    const backoff = createBackoff({ initialMs: 1, maxMs: 4, random: () => 0.5 })
    for (let i = 0; i < 1000; i++) backoff.next()
    expect(backoff.attempts).toBe(2)
  })
})

describe('rate limiter', () => {
  it('starts at most capacity tasks per window, in order', async () => {
    const time = createManualTime()
    const limiter = createRateLimiter({ capacity: 2, windowMs: 1000, ...time })
    const started: number[] = []
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      limiter.run(async () => {
        started.push(i)
        return i
      })
    )

    await time.advance(0)
    expect(started).toEqual([0, 1])
    await time.advance(999)
    expect(started).toEqual([0, 1])
    await time.advance(1)
    expect(started).toEqual([0, 1, 2, 3])
    await time.advance(1000)
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4])
  })

  it('also caps how many run at once', async () => {
    const time = createManualTime()
    const limiter = createRateLimiter({ capacity: 2, windowMs: 10, ...time })
    const releases: (() => void)[] = []
    let started = 0
    const slow = (): Promise<void> =>
      limiter.run(() => {
        started++
        return new Promise<void>((resolve) => releases.push(resolve))
      })
    void slow()
    void slow()
    void slow()

    await time.advance(100)
    expect(started).toBe(2)
    releases[0]!()
    await time.advance(0)
    expect(started).toBe(3)
  })

  it('passes results and errors through', async () => {
    const time = createManualTime()
    const limiter = createRateLimiter({ capacity: 1, windowMs: 10, ...time })
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
    const failing = limiter.run(async () => {
      throw new Error('boom')
    })
    await time.advance(10)
    await expect(failing).rejects.toThrow('boom')
  })
})

describe('manual time', () => {
  it('fires sleeps in order and supports abort', async () => {
    const time = createManualTime()
    const order: string[] = []
    void time.scheduler.sleep(20).then(() => order.push('20'))
    void time.scheduler.sleep(10).then(() => order.push('10'))
    const listeners = new Set<() => void>()
    const signal = {
      aborted: false,
      addEventListener: (_: 'abort', listener: () => void) => listeners.add(listener),
      removeEventListener: (_: 'abort', listener: () => void) => listeners.delete(listener)
    }
    const aborted = time.scheduler.sleep(15, signal)
    signal.aborted = true
    for (const listener of listeners) listener()
    await expect(aborted).rejects.toBeInstanceOf(AbortError)
    await time.advance(25)
    expect(order).toEqual(['10', '20'])
    expect(time.pending).toBe(0)
  })
})

describe('emitter', () => {
  it('delivers to subscribers until they unsubscribe', () => {
    const emitter = createEmitter<{ tick: number }>()
    const listener = vi.fn()
    const off = emitter.on('tick', listener)
    emitter.emit('tick', 1)
    off()
    emitter.emit('tick', 2)
    expect(listener.mock.calls).toEqual([[1]])
  })

  it('keeps delivering when a listener throws', () => {
    const onListenerError = vi.fn()
    const emitter = createEmitter<{ tick: number }>({ onListenerError })
    const second = vi.fn()
    emitter.on('tick', () => {
      throw new Error('boom')
    })
    emitter.on('tick', second)
    emitter.emit('tick', 1)
    expect(second).toHaveBeenCalledWith(1)
    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), 'tick')
  })
})
