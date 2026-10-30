// Test builders for the domain model: sensible defaults, override what a test cares about.
import type { Benefit, Campaign, Channel, Drop, Game, MiningPreferences, Stream } from './types'

export const NOW = new Date('2026-10-30T12:00:00Z')
export const hoursFromNow = (hours: number): Date => new Date(NOW.getTime() + hours * 3_600_000)

export const RUST: Game = { id: '263490', name: 'Rust' }
export const MARVEL: Game = { id: '1264310518', name: 'Marvel Rivals' }
export const SPECIAL_GAME: Game = { id: '509663', name: 'Special Events' }

export function benefit(overrides: Partial<Benefit> = {}): Benefit {
  return {
    id: 'benefit-1',
    name: 'Hoodie',
    type: 'DIRECT_ENTITLEMENT',
    imageUrl: 'https://x/b.png',
    ...overrides
  }
}

export function drop(overrides: Partial<Drop> = {}): Drop {
  return {
    id: 'drop-1',
    name: 'Drop 1',
    startsAt: hoursFromNow(-24),
    endsAt: hoursFromNow(24),
    requiredMinutes: 60,
    realMinutes: 0,
    extraMinutes: 0,
    claimed: false,
    preconditionIds: [],
    benefits: [benefit()],
    ...overrides
  }
}

export function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'campaign-1',
    name: 'Rust Drops',
    game: RUST,
    status: 'ACTIVE',
    startsAt: hoursFromNow(-48),
    endsAt: hoursFromNow(48),
    linked: true,
    allowedChannels: [],
    drops: [drop()],
    ...overrides
  }
}

export function stream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: 'stream-1',
    game: RUST,
    viewers: 100,
    title: 'live',
    dropsEnabled: true,
    ...overrides
  }
}

export function channel(overrides: Partial<Channel> = {}): Channel {
  return { id: 'channel-1', login: 'streamer', aclBased: false, stream: stream(), ...overrides }
}

export function preferences(overrides: Partial<MiningPreferences> = {}): MiningPreferences {
  return {
    priority: [],
    exclude: [],
    priorityMode: 'priorityOnly',
    enableBadgesEmotes: false,
    ...overrides
  }
}
