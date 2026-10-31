// Choosing what to watch, from docs/port-plan.md §3 "Choosing what to watch".
import { describe, expect, it } from 'vitest'
import {
  campaign,
  channel,
  drop,
  hoursFromNow,
  MARVEL,
  NOW,
  preferences,
  RUST,
  SPECIAL_GAME,
  stream
} from './builders.test-support'
import type { EarnContext } from './rules'
import {
  activeCampaign,
  canWatch,
  capChannels,
  MAX_CHANNELS,
  maintenanceTriggers,
  pickChannel,
  rankChannels,
  selectWantedGames,
  shouldSwitch,
  watchBlocker
} from './selection'
import type { Game, MiningPreferences } from './types'

const VALORANT: Game = { id: '516575', name: 'VALORANT' }
const ctx = (prefs: Partial<MiningPreferences> = {}): EarnContext => ({
  now: NOW,
  preferences: preferences(prefs)
})

const forGame = (game: Game, overrides: Parameters<typeof campaign>[0] = {}) =>
  campaign({ id: `c-${game.id}`, game, ...overrides })

describe('selectWantedGames', () => {
  const rust = forGame(RUST, { endsAt: hoursFromNow(48) })
  const marvel = forGame(MARVEL, { endsAt: hoursFromNow(10) })
  const valorant = forGame(VALORANT, {
    endsAt: hoursFromNow(30),
    drops: [drop({ endsAt: hoursFromNow(30), requiredMinutes: 1500 })]
  })
  const all = [rust, marvel, valorant]
  const names = (games: Game[]): string[] => games.map((g) => g.name)

  it('in priority-only mode, wants just the priority list, in its order', () => {
    const prefs = preferences({ priority: ['Marvel Rivals', 'Rust'], priorityMode: 'priorityOnly' })
    expect(names(selectWantedGames(all, prefs, NOW))).toEqual(['Marvel Rivals', 'Rust'])
  })

  it('in ending-soonest mode, puts priority games first, then the rest by end time', () => {
    const prefs = preferences({ priority: ['Rust'], priorityMode: 'endingSoonest' })
    expect(names(selectWantedGames(all, prefs, NOW))).toEqual(['Rust', 'Marvel Rivals', 'VALORANT'])
  })

  it('in low-availability mode, puts the tightest campaigns first', () => {
    const prefs = preferences({ priorityMode: 'lowAvailabilityFirst' })
    // VALORANT needs 1500 of its 1800 remaining minutes; the others have lots of slack.
    expect(names(selectWantedGames(all, prefs, NOW))[0]).toBe('VALORANT')
  })

  it('never wants excluded games', () => {
    const prefs = preferences({ exclude: ['Rust'], priorityMode: 'endingSoonest' })
    expect(names(selectWantedGames(all, prefs, NOW))).not.toContain('Rust')
  })

  it('skips games that can’t be progressed within the next hour', () => {
    const later = forGame(VALORANT, {
      status: 'UPCOMING',
      startsAt: hoursFromNow(5),
      drops: [drop({ startsAt: hoursFromNow(5) })]
    })
    const prefs = preferences({ priority: ['VALORANT'] })
    expect(selectWantedGames([later], prefs, NOW)).toEqual([])
  })

  it('lists each game once, even with several campaigns', () => {
    const second = forGame(RUST, { id: 'c-rust-2' })
    const prefs = preferences({ priority: ['Rust'] })
    expect(names(selectWantedGames([rust, second], prefs, NOW))).toEqual(['Rust'])
  })
})

describe('canWatch', () => {
  const wanted = [RUST]
  const campaigns = [forGame(RUST)]

  it('accepts a live, drops-enabled channel streaming a wanted game with an earnable campaign', () => {
    expect(canWatch(channel(), campaigns, wanted, ctx())).toBe(true)
  })

  it.each([
    ['offline', channel({ stream: undefined })],
    ['without drops enabled', channel({ stream: stream({ dropsEnabled: false }) })],
    ['streaming an unwanted game', channel({ stream: stream({ game: MARVEL }) })]
  ])('rejects a channel %s', (_name, ch) => {
    expect(canWatch(ch, campaigns, wanted, ctx())).toBe(false)
  })

  it('accepts any live channel for a special-game campaign', () => {
    const special = [forGame(SPECIAL_GAME)]
    const ch = channel({ stream: stream({ game: MARVEL, dropsEnabled: false }) })
    expect(canWatch(ch, special, [], ctx())).toBe(true)
  })
})

describe('watchBlocker', () => {
  const wanted = [RUST]
  const campaigns = [forGame(RUST)]

  it.each([
    ['nothing for a watchable channel', channel(), undefined],
    ['offline', channel({ stream: undefined }), 'offline'],
    ['drops off', channel({ stream: stream({ dropsEnabled: false }) }), 'dropsOff'],
    ['another game', channel({ stream: stream({ game: MARVEL }) }), 'otherGame']
  ])('says %s', (_name, ch, expected) => {
    expect(watchBlocker(ch, campaigns, wanted, ctx())).toBe(expected)
  })

  it('says nothing is left to earn when the wanted game has no earnable campaign', () => {
    const unlinked = [forGame(RUST, { linked: false })]
    expect(watchBlocker(channel(), unlinked, wanted, ctx())).toBe('nothingToEarn')
  })
})

describe('rankChannels', () => {
  it('orders by game priority, then allowed-list channels, then viewers', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'marvel-big', stream: stream({ game: MARVEL, viewers: 9000 }) }),
        channel({ id: 'rust-small', stream: stream({ viewers: 10 }) }),
        channel({ id: 'rust-big', stream: stream({ viewers: 500 }) }),
        channel({ id: 'rust-acl', aclBased: true, stream: stream({ viewers: 1 }) }),
        channel({ id: 'offline', stream: undefined })
      ],
      [RUST, MARVEL]
    )
    expect(ranked.map((c) => c.id)).toEqual([
      'rust-acl',
      'rust-big',
      'rust-small',
      'marvel-big',
      'offline'
    ])
  })

  it('keeps at most 199 channels (8 sockets × 50 topics − 2, two topics each)', () => {
    expect(MAX_CHANNELS).toBe(199)
    const many = Array.from({ length: 250 }, (_, i) => channel({ id: `c${i}` }))
    expect(capChannels(many)).toHaveLength(199)
  })
})

describe('switching', () => {
  const wanted = [RUST, MARVEL]
  const campaigns = [forGame(RUST), forGame(MARVEL)]
  const rustChannel = channel({ id: 'rust', stream: stream({ game: RUST }) })
  const marvelChannel = channel({ id: 'marvel', stream: stream({ game: MARVEL }) })

  it('switches when nothing watchable is being watched', () => {
    expect(shouldSwitch(marvelChannel, undefined, campaigns, wanted, ctx())).toBe(true)
  })

  it('switches only for a strictly better game priority', () => {
    expect(shouldSwitch(rustChannel, marvelChannel, campaigns, wanted, ctx())).toBe(true)
    expect(shouldSwitch(marvelChannel, rustChannel, campaigns, wanted, ctx())).toBe(false)
  })

  it('switches at equal priority only from a directory channel to an allowed-list one', () => {
    const otherRust = channel({ id: 'rust-2' })
    const aclRust = channel({ id: 'rust-acl', aclBased: true })
    expect(shouldSwitch(otherRust, rustChannel, campaigns, wanted, ctx())).toBe(false)
    expect(shouldSwitch(aclRust, rustChannel, campaigns, wanted, ctx())).toBe(true)
    expect(shouldSwitch(rustChannel, aclRust, campaigns, wanted, ctx())).toBe(false)
  })

  it('never switches to a channel it can’t watch', () => {
    const offline = channel({ id: 'off', stream: undefined })
    expect(shouldSwitch(offline, undefined, campaigns, wanted, ctx())).toBe(false)
  })
})

describe('pickChannel', () => {
  const wanted = [RUST, MARVEL]
  const campaigns = [forGame(RUST), forGame(MARVEL)]
  const rustChannel = channel({ id: 'rust' })
  const marvelChannel = channel({ id: 'marvel', stream: stream({ game: MARVEL }) })
  const base = { channels: [marvelChannel, rustChannel], campaigns, wanted, ctx: ctx() }

  it('prefers the user’s manual choice when it’s watchable', () => {
    expect(pickChannel({ ...base, selected: marvelChannel })).toEqual({
      channel: marvelChannel,
      reason: 'selected'
    })
  })

  it('otherwise picks the best channel worth switching to', () => {
    expect(pickChannel({ ...base, watching: marvelChannel })).toEqual({
      channel: rustChannel,
      reason: 'better'
    })
  })

  it('stays on the current channel when nothing is better', () => {
    expect(pickChannel({ ...base, watching: rustChannel })).toEqual({
      channel: rustChannel,
      reason: 'stay'
    })
  })

  it('reports when there is nothing to watch', () => {
    expect(pickChannel({ ...base, channels: [], watching: undefined })).toEqual({ reason: 'none' })
  })
})

describe('activeCampaign', () => {
  it('is the earnable campaign closest to completion on the channel', () => {
    const long = forGame(RUST, { id: 'long', drops: [drop({ requiredMinutes: 240 })] })
    const short = forGame(RUST, { id: 'short', drops: [drop({ requiredMinutes: 30 })] })
    expect(activeCampaign(channel(), [long, short], [RUST], ctx())?.id).toBe('short')
    expect(activeCampaign(channel(), [long, short], [], ctx())).toBeUndefined()
  })
})

describe('maintenanceTriggers', () => {
  it('lists campaign and drop start and end times within the next hour, in order', () => {
    const c = forGame(RUST, {
      endsAt: hoursFromNow(0.75),
      drops: [
        drop({ id: 'a', startsAt: hoursFromNow(-1), endsAt: hoursFromNow(0.25) }),
        drop({ id: 'b', startsAt: hoursFromNow(0.5), endsAt: hoursFromNow(0.75) })
      ]
    })
    expect(maintenanceTriggers([c], ctx()).map((d) => d.toISOString())).toEqual([
      hoursFromNow(0.25).toISOString(),
      hoursFromNow(0.5).toISOString(),
      hoursFromNow(0.75).toISOString()
    ])
  })

  it('ignores campaigns that can’t be earned within the hour', () => {
    expect(maintenanceTriggers([forGame(RUST, { linked: false })], ctx())).toEqual([])
  })
})
