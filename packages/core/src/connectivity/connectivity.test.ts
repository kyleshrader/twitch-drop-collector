import { createManualTime } from '@tdc/kernel/testing'
import { describe, expect, it } from 'vitest'
import { testLogger } from '../test-support/fake-gql'
import { createConnectivity, type PowerEvents } from './connectivity'

function setup() {
  const time = createManualTime()
  const listeners = { suspend: new Set<() => void>(), resume: new Set<() => void>() }
  const power: PowerEvents = {
    on(event, listener) {
      listeners[event].add(listener)
      return () => listeners[event].delete(listener)
    }
  }
  let online = true
  const connectivity = createConnectivity({
    isOnline: () => online,
    power,
    scheduler: time.scheduler,
    logger: testLogger(),
    checkEveryMs: 1_000
  })
  const changes: string[] = []
  connectivity.onChange((state) => changes.push(state))
  return {
    time,
    connectivity,
    changes,
    listeners,
    setOnline: (value: boolean) => (online = value),
    fire: (event: 'suspend' | 'resume') => listeners[event].forEach((l) => l())
  }
}

describe('connectivity', () => {
  it('notices going offline and coming back at the next check', async () => {
    const { time, connectivity, changes, setOnline } = setup()
    connectivity.start()
    expect(connectivity.state()).toBe('online')

    setOnline(false)
    await time.advance(999)
    expect(changes).toEqual([])
    await time.advance(1)
    expect(connectivity.state()).toBe('offline')

    setOnline(true)
    await time.advance(1_000)
    expect(changes).toEqual(['offline', 'online'])
    connectivity.stop()
  })

  it('reports being offline at start', () => {
    const { connectivity, changes, setOnline } = setup()
    setOnline(false)
    connectivity.start()
    expect(changes).toEqual(['offline'])
    connectivity.stop()
  })

  it('is asleep from suspend to resume, whatever the network says', async () => {
    const { time, connectivity, changes, fire } = setup()
    connectivity.start()
    fire('suspend')
    expect(connectivity.state()).toBe('asleep')
    await time.advance(5_000)
    expect(connectivity.state()).toBe('asleep')
    fire('resume')
    expect(changes).toEqual(['asleep', 'online'])
    connectivity.stop()
  })

  it('stops checking and drops its power listeners on stop', async () => {
    const { time, connectivity, listeners } = setup()
    connectivity.start()
    connectivity.stop()
    expect(listeners.suspend.size + listeners.resume.size).toBe(0)
    expect(time.pending).toBe(0)
  })
})
