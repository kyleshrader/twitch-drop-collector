import type { Campaign, Channel, MinerSnapshot } from '@tdc/core'
import { MinerView } from '@tdc/ipc-contract'
import type { Logger } from '@tdc/kernel'
import { describe, expect, it, vi } from 'vitest'
import { createEventPublisher } from '../ipc/events'
import { toMinerView } from './views'

const NOW = new Date('2026-10-30T12:00:00Z')
const ctx = { now: NOW, preferences: { enableBadgesEmotes: false } }
const at = (hours: number): Date => new Date(NOW.getTime() + hours * 3_600_000)

const campaign = (
  id: string,
  starts: number,
  ends: number,
  status: Campaign['status'] = 'ACTIVE'
): Campaign => ({
  id,
  name: `Campaign ${id}`,
  game: { id: 'g', name: 'Rust' },
  status,
  startsAt: at(starts),
  endsAt: at(ends),
  linked: true,
  allowedChannels: [],
  drops: [
    {
      id: `${id}-d`,
      name: 'Drop',
      startsAt: at(starts),
      endsAt: at(ends),
      requiredMinutes: 60,
      realMinutes: 50,
      extraMinutes: 15,
      claimed: false,
      preconditionIds: [],
      benefits: [
        { id: 'b', name: 'Hoodie', type: 'DIRECT_ENTITLEMENT', imageUrl: 'https://x/b.png' }
      ]
    }
  ]
})

const live: Channel = {
  id: 'c1',
  login: 'streamer',
  aclBased: false,
  stream: { id: 's', game: { id: 'g', name: 'Rust' }, viewers: 42, title: 't', dropsEnabled: true }
}

function testLogger(): Logger {
  const logger: Logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger
  }
  return logger
}

describe('toMinerView', () => {
  const campaigns = [
    campaign('old', -48, -1, 'EXPIRED'),
    campaign('soon', 2, 48),
    campaign('now', -1, 24)
  ]
  const snapshot: MinerSnapshot = {
    status: 'watching',
    watching: live,
    active: { campaign: campaigns[2]!, drop: campaigns[2]!.drops[0]! },
    wanted: [{ id: 'g', name: 'Rust' }]
  }
  const view = toMinerView(
    snapshot,
    campaigns,
    [live, { ...live, id: 'c2', stream: undefined }],
    ctx
  )

  it('matches the contract the renderer validates', () => {
    expect(MinerView.safeParse(view).success).toBe(true)
  })

  it('orders campaigns active, upcoming, then ended', () => {
    expect(view.campaigns.map((c) => [c.id, c.state])).toEqual([
      ['now', 'active'],
      ['soon', 'upcoming'],
      ['old', 'expired']
    ])
  })

  it('caps shown minutes at the requirement, estimates included', () => {
    expect(view.active?.drop).toMatchObject({
      minutes: 60,
      requiredMinutes: 60,
      rewards: ['Hoodie']
    })
  })

  it('flags finished drops that wait for a connected game account', () => {
    const unlinked = { ...campaign('acct', -48, -1, 'EXPIRED'), linked: false }
    unlinked.drops = unlinked.drops.map((d) => ({ ...d, realMinutes: 60, claimId: 'i' }))
    const [drop] = toMinerView({ status: 'idle', wanted: [] }, [unlinked], [], ctx).campaigns[0]!
      .drops
    expect(drop).toMatchObject({ claimed: false, awaitsConnection: true })
    expect(view.campaigns[0]!.drops[0]!.awaitsConnection).toBe(false)
  })

  it('describes channels by online state', () => {
    expect(view.channels.map((c) => [c.id, c.online, c.viewers])).toEqual([
      ['c1', true, 42],
      ['c2', false, undefined]
    ])
    expect(view.watching).toMatchObject({ login: 'streamer', game: 'Rust' })
  })

  it('says which channels a manual pick would work for, and why not', () => {
    // The fixture campaign's drop already counts as done (50 + 15 estimated of 60 minutes).
    expect(view.channels.map((c) => [c.id, c.unwatchable])).toEqual([
      ['c1', 'nothingToEarn'],
      ['c2', 'offline']
    ])
    const fresh = campaign('fresh', -1, 24)
    fresh.drops = fresh.drops.map((d) => ({ ...d, realMinutes: 0, extraMinutes: 0 }))
    const withMinutesLeft = toMinerView(snapshot, [fresh], [live], ctx)
    expect(withMinutesLeft.channels[0]!.unwatchable).toBeUndefined()
  })

  it('reports the user’s pick', () => {
    expect(view.selected).toBeUndefined()
    expect(toMinerView({ ...snapshot, selectedId: 'c1' }, campaigns, [live], ctx).selected).toBe(
      'c1'
    )
  })
})

describe('event publisher', () => {
  it('sends events that match the contract to the window', () => {
    const send = vi.fn()
    const publisher = createEventPublisher({ target: () => ({ send }), logger: testLogger() })
    publisher.publish('auth:state', { status: 'signedOut' })
    expect(send).toHaveBeenCalledWith('auth:state', { status: 'signedOut' })
  })

  it('refuses payloads that break the contract, and strips undeclared fields', () => {
    const send = vi.fn()
    const logger = testLogger()
    const publisher = createEventPublisher({ target: () => ({ send }), logger })
    publisher.publish('auth:state', { status: 'nonsense' } as never)
    expect(send).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()

    publisher.publish('auth:state', {
      status: 'signedIn',
      user: { id: '1', login: 'kyle' },
      verified: true,
      accessToken: 'secret'
    } as never)
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret')
  })

  it('does nothing without a window', () => {
    const publisher = createEventPublisher({ target: () => undefined, logger: testLogger() })
    expect(() => publisher.publish('auth:state', { status: 'signedOut' })).not.toThrow()
  })
})
