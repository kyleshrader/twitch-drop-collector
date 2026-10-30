import type { RealtimeSource } from '@tdc/api'
import { createEmitter } from '@tdc/kernel'
import { createManualTime, type ManualTime } from '@tdc/kernel/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelService } from '../channels/channel-service'
import {
  campaign,
  channel,
  drop,
  hoursFromNow,
  MARVEL,
  preferences,
  RUST,
  stream
} from '../domain/builders.test-support'
import { applyDropMinutes, bumpEstimatedMinutes, markClaimed, setClaimId } from '../domain/rules'
import { rankChannels } from '../domain/selection'
import type { Campaign, Channel, MiningPreferences } from '../domain/types'
import type { InventoryService } from '../inventory/inventory-service'
import { fakeGql, testLogger, type FakeGql } from '../test-support/fake-gql'
import type { WatchService } from '../watch/watch-service'
import { createMiner, type Miner } from './miner'

// ---- fakes ---------------------------------------------------------------------------------

function fakeInventory(initial: Campaign[]) {
  let campaigns = initial
  const find = (dropId: string) => {
    for (const c of campaigns) {
      const d = c.drops.find((x) => x.id === dropId)
      if (d) return { campaign: c, drop: d }
    }
    return undefined
  }
  const replace = (next: Campaign): void => {
    campaigns = campaigns.map((c) => (c.id === next.id ? next : c))
  }
  const service: InventoryService & { set(next: Campaign[]): void } = {
    set: (next) => (campaigns = next),
    campaigns: () => campaigns,
    find,
    refresh: vi.fn(async () => campaigns),
    updateDropMinutes: vi.fn((dropId: string, minutes: number) => {
      const found = find(dropId)
      if (!found) return undefined
      const next = applyDropMinutes(found.campaign, dropId, minutes)
      replace(next)
      return next
    }),
    bumpEstimatedMinutes: vi.fn((campaignId, ctx, ch) => {
      const c = campaigns.find((x) => x.id === campaignId)!
      const result = bumpEstimatedMinutes(c, ctx, ch)
      replace(result.campaign)
      return { reachedCap: result.reachedCap }
    }),
    setClaimId: vi.fn((dropId: string, claimId: string) => {
      const found = find(dropId)
      if (found) replace(setClaimId(found.campaign, dropId, claimId))
    }),
    claim: vi.fn(async (dropId: string) => {
      const found = find(dropId)
      if (!found) return false
      replace(markClaimed(found.campaign, dropId))
      return true
    }),
    claimAll: vi.fn(async () => []),
    onChange: () => () => {}
  }
  return service
}

function fakeChannels(initial: Channel[]) {
  let all = initial
  /** What the next stream re-fetch returns per channel (undefined: offline). */
  const nextStream = new Map<string, Channel['stream']>()
  const service: ChannelService & { nextStream: typeof nextStream } = {
    nextStream,
    channels: () => all,
    get: (id) => all.find((c) => c.id === id),
    refresh: vi.fn(async ({ wanted }) => {
      all = rankChannels(all, wanted)
      return all
    }),
    updateStream: vi.fn(async (id: string) => {
      const c = all.find((x) => x.id === id)
      if (!c) return undefined
      const before = c.stream
      const after = nextStream.has(id) ? nextStream.get(id) : c.stream
      all = all.map((x) => {
        if (x.id !== id) return x
        const rest: Channel = { ...x }
        delete rest.stream
        return after ? { ...rest, stream: after } : rest
      })
      return { ...(before ? { before } : {}), ...(after ? { after } : {}) }
    }),
    setOffline: vi.fn((id: string) => {
      const c = all.find((x) => x.id === id)
      if (!c?.stream) return undefined
      const { stream, ...rest } = c
      all = all.map((x) => (x.id === id ? rest : x))
      return stream
    }),
    setViewers: vi.fn((id: string, viewers: number) => {
      all = all.map((x) =>
        x.id === id && x.stream ? { ...x, stream: { ...x.stream, viewers } } : x
      )
    }),
    onChange: () => () => {}
  }
  return service
}

function fakeWatch() {
  const events = createEmitter<{
    tick: Parameters<Parameters<WatchService['onTick']>[0]>[0]
    check: Channel
  }>()
  let target: Channel | undefined
  const service: WatchService & {
    tick(ok: boolean): void
    check(): void
    restarts: number
    history: (string | undefined)[]
  } = {
    restarts: 0,
    history: [],
    watching: () => target,
    watch: (c) => {
      target = c
      service.history.push(c?.login)
    },
    restart: () => {
      service.restarts++
    },
    start: () => {},
    stop: async () => {},
    onTick: (l) => events.on('tick', l),
    onProgressCheck: (l) => events.on('check', l),
    tick: (ok) => target && events.emit('tick', { channel: target, ok, at: new Date() }),
    check: () => target && events.emit('check', target)
  }
  return service
}

function fakeRealtime() {
  const topics = new Map<string, Set<(m: unknown) => void>>()
  const realtime: RealtimeSource & {
    publish(topic: string, message: unknown): void
    topics: () => string[]
  } = {
    subscribe: (topic, handler) => {
      let set = topics.get(topic)
      if (!set) topics.set(topic, (set = new Set()))
      set.add(handler)
      return () => {
        set.delete(handler)
        if (set.size === 0) topics.delete(topic)
      }
    },
    start: () => {},
    stop: async () => {},
    onStatus: () => () => {},
    publish: (topic, message) => topics.get(topic)?.forEach((h) => h(message)),
    topics: () => [...topics.keys()].sort()
  }
  return realtime
}

// ---- setup -----------------------------------------------------------------------------------

const rustCampaign = campaign({
  id: 'rust-c',
  game: RUST,
  drops: [
    drop({ id: 'rust-d1', requiredMinutes: 60 }),
    drop({ id: 'rust-d2', requiredMinutes: 120 })
  ]
})
const marvelCampaign = campaign({
  id: 'marvel-c',
  game: MARVEL,
  drops: [drop({ id: 'marvel-d1', requiredMinutes: 30 })]
})
const rustBig = channel({
  id: 'rust-big',
  login: 'rust_big',
  stream: stream({ game: RUST, viewers: 900 })
})
const rustSmall = channel({
  id: 'rust-small',
  login: 'rust_small',
  stream: stream({ game: RUST, viewers: 10 })
})
const marvelOne = channel({
  id: 'marvel-1',
  login: 'marvel_one',
  stream: stream({ game: MARVEL, viewers: 50 })
})

let miner: Miner | undefined
afterEach(async () => {
  await miner?.stop()
})

function setup(
  options: {
    campaigns?: Campaign[]
    channels?: Channel[]
    prefs?: Partial<MiningPreferences>
    gql?: FakeGql
  } = {}
) {
  const time: ManualTime = createManualTime(hoursFromNow(0).getTime())
  const inventory = fakeInventory(options.campaigns ?? [rustCampaign, marvelCampaign])
  const channels = fakeChannels(options.channels ?? [marvelOne, rustSmall, rustBig])
  const watch = fakeWatch()
  const realtime = fakeRealtime()
  const client =
    options.gql ??
    fakeGql({
      DropCurrentSessionContext: () => ({ currentUser: { dropCurrentSession: null } }),
      OnsiteNotifications_DeleteNotification: () => ({})
    })
  const claims: string[] = []
  miner = createMiner({
    inventory,
    channels,
    watch,
    realtime,
    gql: client,
    userId: () => 'user-1',
    preferences: () => preferences({ priority: ['Rust', 'Marvel Rivals'], ...options.prefs }),
    clock: time.clock,
    scheduler: time.scheduler,
    logger: testLogger(),
    onClaim: (n) => claims.push(`${n.gameName}: ${n.dropName}`)
  })
  return { miner, inventory, channels, watch, realtime, client, time, claims }
}

const started = async (s: ReturnType<typeof setup>): Promise<void> => {
  s.miner.start()
  await s.time.advance(0)
}

// ---- tests -----------------------------------------------------------------------------------

describe('miner', () => {
  it('loads, claims, picks wanted games and watches the best channel', async () => {
    const s = setup()
    await started(s)
    expect(s.inventory.refresh).toHaveBeenCalledTimes(1)
    expect(s.inventory.claimAll).toHaveBeenCalledTimes(1)
    expect(s.miner.snapshot()).toMatchObject({
      status: 'watching',
      watching: { id: 'rust-big' },
      active: { campaign: { id: 'rust-c' }, drop: { id: 'rust-d1' } },
      wanted: [RUST, MARVEL]
    })
    expect(s.realtime.topics()).toEqual(
      [
        'broadcast-settings-update.marvel-1',
        'broadcast-settings-update.rust-big',
        'broadcast-settings-update.rust-small',
        'onsite-notifications.user-1',
        'user-drop-events.user-1',
        'video-playback-by-id.marvel-1',
        'video-playback-by-id.rust-big',
        'video-playback-by-id.rust-small'
      ].sort()
    )
  })

  it('goes idle, with a reason, when nothing is wanted', async () => {
    const s = setup({ prefs: { priority: [] } })
    await started(s)
    expect(s.miner.snapshot()).toMatchObject({
      status: 'idle',
      message: 'No campaigns to mine right now'
    })
    expect(s.watch.watching()).toBeUndefined()
  })

  it('applies drop progress from PubSub to the drop being earned', async () => {
    const s = setup()
    await started(s)
    s.realtime.publish('user-drop-events.user-1', {
      type: 'drop-progress',
      data: { drop_id: 'rust-d1', current_progress_min: 12, required_progress_min: 60 }
    })
    expect(s.inventory.find('rust-d1')?.drop.realMinutes).toBe(12)
    // Progress for a game we aren't watching is ignored.
    s.realtime.publish('user-drop-events.user-1', {
      type: 'drop-progress',
      data: { drop_id: 'marvel-d1', current_progress_min: 5 }
    })
    expect(s.inventory.find('marvel-d1')?.drop.realMinutes).toBe(0)
  })

  it('claims on drop-claim, waits for Twitch to move on, then keeps watching', async () => {
    let polls = 0
    const client = fakeGql({
      // The session still shows the claimed drop twice, then moves on.
      DropCurrentSessionContext: () => ({
        currentUser: {
          dropCurrentSession: ++polls <= 2 ? { dropID: 'rust-d1', currentMinutesWatched: 60 } : null
        }
      })
    })
    const s = setup({ gql: client })
    await started(s)
    s.realtime.publish('user-drop-events.user-1', {
      type: 'drop-claim',
      data: { drop_id: 'rust-d1', drop_instance_id: 'user-1#rust-c#rust-d1' }
    })
    await s.time.advance(0)
    expect(s.inventory.setClaimId).toHaveBeenCalledWith('rust-d1', 'user-1#rust-c#rust-d1')
    expect(s.claims).toEqual(['Rust: Drop 1'])

    await s.time.advance(4_000) // settle
    await s.time.advance(4_000) // two more polls, 2s apart
    expect(client.calls['DropCurrentSessionContext']).toHaveLength(3)
    expect(s.watch.restarts).toBe(1)
    expect(s.miner.snapshot().active?.drop?.id).toBe('rust-d2')
  })

  it('switches away when the watched channel goes offline', async () => {
    const s = setup()
    await started(s)
    s.realtime.publish('video-playback-by-id.rust-big', { type: 'stream-down' })
    expect(s.watch.watching()?.id).toBe('rust-small')
  })

  it('switches to a better channel once its stream-up is confirmed, 120s later', async () => {
    const offlineRust = channel({
      id: 'rust-acl',
      login: 'rust_acl',
      aclBased: true,
      stream: undefined
    })
    const s = setup({ channels: [marvelOne, offlineRust] })
    await started(s)
    expect(s.watch.watching()?.id).toBe('marvel-1')

    s.channels.nextStream.set('rust-acl', stream({ game: RUST }))
    s.realtime.publish('video-playback-by-id.rust-acl', { type: 'stream-up' })
    await s.time.advance(119_000)
    expect(s.watch.watching()?.id).toBe('marvel-1')
    await s.time.advance(1_000)
    expect(s.watch.watching()?.id).toBe('rust-acl')
  })

  it('keeps viewer counts current', async () => {
    const s = setup()
    await started(s)
    s.realtime.publish('video-playback-by-id.rust-small', { type: 'viewcount', viewers: 77 })
    expect(s.channels.get('rust-small')?.stream?.viewers).toBe(77)
  })

  it('asks Twitch for progress when it has gone quiet, then estimates if Twitch has nothing', async () => {
    let session: { dropID: string; currentMinutesWatched: number } | null = {
      dropID: 'rust-d1',
      currentMinutesWatched: 20
    }
    const client = fakeGql({
      DropCurrentSessionContext: () => ({ currentUser: { dropCurrentSession: session } })
    })
    const s = setup({ gql: client })
    await started(s)

    s.watch.check() // too soon after starting to watch: nothing to do
    await s.time.advance(0)
    expect(client.calls['DropCurrentSessionContext']).toBeUndefined()

    await s.time.advance(60_000)
    s.watch.check()
    await s.time.advance(0)
    expect(s.inventory.find('rust-d1')?.drop.realMinutes).toBe(20)

    session = null
    await s.time.advance(60_000)
    s.watch.check()
    await s.time.advance(0)
    expect(s.inventory.find('rust-d1')?.drop.extraMinutes).toBe(1)
  })

  it('switches channel when estimates hit the cap', async () => {
    const capped = campaign({
      id: 'rust-c',
      game: RUST,
      drops: [drop({ id: 'rust-d1', extraMinutes: 14 })]
    })
    const s = setup({ campaigns: [capped, marvelCampaign] })
    await started(s)
    await s.time.advance(60_000)
    s.watch.check()
    await s.time.advance(0)
    expect(s.watch.watching()?.id).toBe('marvel-1')
  })

  it('reloads after a reward notification and dismisses it', async () => {
    const s = setup()
    await started(s)
    s.realtime.publish('onsite-notifications.user-1', {
      type: 'create-notification',
      data: { notification: { id: 'n1', type: 'user_drop_reward_reminder_notification' } }
    })
    await s.time.advance(0)
    expect(s.client.calls['OnsiteNotifications_DeleteNotification']).toEqual([
      { notificationId: 'n1' }
    ])
    expect(s.inventory.refresh).toHaveBeenCalledTimes(2)
  })

  it('reloads every hour', async () => {
    const s = setup()
    await started(s)
    await s.time.advance(60 * 60 * 1000)
    expect(s.inventory.refresh).toHaveBeenCalledTimes(2)
  })

  it('honours a manual channel choice while it’s watchable', async () => {
    const s = setup()
    await started(s)
    s.miner.selectChannel('marvel-1')
    await s.time.advance(0)
    expect(s.watch.watching()?.id).toBe('marvel-1')
    s.miner.selectChannel(undefined)
    await s.time.advance(0)
    expect(s.watch.watching()?.id).toBe('rust-big')
  })

  it('re-checks a channel when a watch fails', async () => {
    const s = setup()
    await started(s)
    s.channels.nextStream.set('rust-big', undefined)
    s.watch.tick(false)
    await s.time.advance(0)
    expect(s.channels.updateStream).toHaveBeenCalledWith(
      'rust-big',
      expect.anything(),
      expect.anything()
    )
    expect(s.watch.watching()?.id).toBe('rust-small')
  })

  it('reports a failed reload and retries five minutes later', async () => {
    const s = setup()
    vi.mocked(s.inventory.refresh).mockRejectedValueOnce(new Error('Twitch is down'))
    await started(s)
    expect(s.miner.snapshot()).toMatchObject({ status: 'error', message: 'Twitch is down' })
    await s.time.advance(5 * 60 * 1000)
    expect(s.miner.snapshot().status).toBe('watching')
  })

  it('stops cleanly: unsubscribes everything and stops watching', async () => {
    const s = setup()
    await started(s)
    await s.miner.stop()
    expect(s.realtime.topics()).toEqual([])
    expect(s.watch.watching()).toBeUndefined()
    expect(s.miner.snapshot().status).toBe('stopped')
  })
})
