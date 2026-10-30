import type { StreamWatcher } from '@tdc/api'
import { createManualTime } from '@tdc/kernel/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { channel } from '../domain/builders.test-support'
import { testLogger } from '../test-support/fake-gql'
import { createWatchService, type WatchService } from './watch-service'

let service: WatchService | undefined
afterEach(async () => {
  await service?.stop()
})

function setup(result: boolean | (() => Promise<boolean>) = true) {
  const time = createManualTime()
  const watcher: StreamWatcher = {
    watch: vi.fn(typeof result === 'function' ? result : async () => result),
    forget: vi.fn()
  }
  service = createWatchService({ watcher, ...time, logger: testLogger() })
  const ticks: string[] = []
  const checks: string[] = []
  const start = time.clock.now().getTime()
  const at = (): number => (time.clock.now().getTime() - start) / 1000
  service.onTick((t) => ticks.push(`${at()}s ${t.channel.login} ${t.ok ? 'ok' : 'failed'}`))
  service.onProgressCheck((c) => checks.push(`${at()}s ${c.login}`))
  return { service, watcher, time, ticks, checks }
}

const alpha = channel({ id: 'a', login: 'alpha' })
const beta = channel({ id: 'b', login: 'beta' })

describe('watch service', () => {
  it('watches every 20s and asks for a progress check 15s after each watch', async () => {
    const { service, time, ticks, checks } = setup()
    service.start()
    service.watch(alpha)
    await time.advance(0)
    await time.advance(45_000)
    expect(ticks).toEqual(['0s alpha ok', '20s alpha ok', '40s alpha ok'])
    expect(checks).toEqual(['15s alpha', '35s alpha'])
  })

  it('does nothing without a channel', async () => {
    const { service, time, watcher } = setup()
    service.start()
    await time.advance(60_000)
    expect(watcher.watch).not.toHaveBeenCalled()
  })

  it('switches channel immediately', async () => {
    const { service, time, ticks } = setup()
    service.start()
    service.watch(alpha)
    await time.advance(5_000)
    service.watch(beta)
    await time.advance(0)
    await time.advance(20_000)
    expect(ticks).toEqual(['0s alpha ok', '5s beta ok', '25s beta ok'])
  })

  it('stops watching when the target is cleared', async () => {
    const { service, time, ticks } = setup()
    service.start()
    service.watch(alpha)
    await time.advance(1_000)
    service.watch(undefined)
    await time.advance(60_000)
    expect(ticks).toEqual(['0s alpha ok'])
  })

  it('sends a watch right away on restart', async () => {
    const { service, time, ticks } = setup()
    service.start()
    service.watch(alpha)
    await time.advance(7_000)
    service.restart()
    await time.advance(0)
    expect(ticks).toEqual(['0s alpha ok', '7s alpha ok'])
  })

  it('reports failed watches and keeps going', async () => {
    const { service, time, ticks } = setup(async () => {
      throw new Error('usher down')
    })
    service.start()
    service.watch(alpha)
    await time.advance(25_000)
    expect(ticks).toEqual(['0s alpha failed', '20s alpha failed'])
  })

  it('stops cleanly', async () => {
    const { service, time, watcher } = setup()
    service.start()
    service.watch(alpha)
    await time.advance(0)
    await service.stop()
    await time.advance(60_000)
    expect(watcher.watch).toHaveBeenCalledTimes(1)
  })
})
