import type { CampaignView, DropView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import type { ListChoice } from '../data'
import {
  applyFilters,
  breakdown,
  findGame,
  gamesOf,
  groupGames,
  nameId,
  statusOf,
  twitchPageOf
} from './library'

// Wednesday 18 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15, 0).getTime()
const day = (d: number): string => new Date(2026, 10, d, 12).toISOString()

const drop = (overrides: Partial<DropView> = {}): DropView => ({
  id: 'd',
  name: 'Drop',
  minutes: 0,
  requiredMinutes: 60,
  claimed: false,
  awaitsConnection: false,
  rewards: [],
  startsAt: day(1),
  endsAt: day(30),
  ...overrides
})

const campaign = (
  id: string,
  game: string,
  overrides: Partial<CampaignView> = {}
): CampaignView => ({
  id,
  name: id,
  game,
  gameId: `g-${game}`,
  state: 'active',
  linked: true,
  startsAt: day(1),
  endsAt: day(30),
  allowListed: false,
  allowedChannels: [],
  badgesEmotes: false,
  drops: [drop()],
  ...overrides
})

const campaigns = [
  campaign('rust-1', 'Rust', {
    firstSeenAt: day(18),
    drops: [drop({ claimed: true, claimedAt: day(17) })]
  }),
  campaign('rust-2', 'Rust', { state: 'expired', firstSeenAt: day(2) }),
  campaign('rocket', 'Rocket League', {
    firstSeenAt: day(10),
    drops: [drop({ claimed: true, claimedAt: day(3) })]
  }),
  campaign('marvel', 'Marvel Rivals', { drops: [drop({ awaitsConnection: true })] })
]
const lists: Record<string, ListChoice> = { 'Marvel Rivals': 'excluded', Rust: 'priority' }
const listOf = (game: string): ListChoice => lists[game] ?? 'notSet'

describe('library games', () => {
  it('counts every campaign seen, with what each listed one is now', () => {
    const [marvel, rocket, rust] = gamesOf(campaigns, { 'g-Rust': 5 })
    expect(rust).toMatchObject({ seen: 5, lastSeenAt: day(18), lastClaimedAt: day(17) })
    expect(breakdown(rust!)).toEqual({ counts: { completed: 1, missed: 1 }, unlisted: 3 })
    // Never fewer than Twitch lists, even before the history has them.
    expect(rocket!.seen).toBe(1)
    expect(breakdown(marvel!).counts).toEqual({ unclaimed: 1 })
  })

  it('filters by excluded, active, recently claimed and unclaimed', () => {
    const games = gamesOf(campaigns)
    const names = (filters: string[]): string[] =>
      applyFilters(games, new Set(filters as never[]), listOf, NOW).map((g) => g.name)
    expect(names(['hideExcluded'])).toEqual(['Rocket League', 'Rust'])
    expect(names(['recentlyClaimed'])).toEqual(['Rust'])
    expect(names(['unclaimed'])).toEqual(['Marvel Rivals'])
    expect(names(['active', 'hideExcluded'])).toEqual(['Rocket League', 'Rust'])
  })

  it('groups by recently claimed under date headings, never-claimed last', () => {
    const groups = groupGames(gamesOf(campaigns), 'claimed', listOf, NOW)
    expect(groups.map((g) => [g.key, g.games.map((x) => x.name)])).toEqual([
      ['yesterday', ['Rust']],
      ['thisMonth', ['Rocket League']],
      ['neverClaimed', ['Marvel Rivals']]
    ])
  })

  it('groups by recently seen, with games seen before the history as older', () => {
    const groups = groupGames(gamesOf(campaigns), 'seen', listOf, NOW)
    expect(groups.map((g) => [g.key, g.games.map((x) => x.name)])).toEqual([
      ['today', ['Rust']],
      ['lastWeek', ['Rocket League']],
      ['older', ['Marvel Rivals']]
    ])
  })

  it('groups by list and account', () => {
    const games = gamesOf(campaigns)
    expect(groupGames(games, 'list', listOf, NOW).map((g) => g.key)).toEqual([
      'priority',
      'notSet',
      'excluded'
    ])
    expect(groupGames(games, 'account', listOf, NOW).map((g) => g.key)).toEqual(['linked'])
  })
})

describe('games without campaigns', () => {
  it('adds listed games that have no campaigns, once, with art from searches', () => {
    const boxArtUrl = 'https://static-cdn.jtvnw.net/ttv-boxart/1.jpg'
    const known = new Map([['Rob Run', { boxArtUrl, slug: 'rob-run' }]])
    const games = gamesOf(campaigns, {}, ['Rust', 'Rob Run', 'Rob Run'], known)
    const rob = games.filter((g) => g.name === 'Rob Run')
    expect(rob).toEqual([
      { id: nameId('Rob Run'), name: 'Rob Run', boxArtUrl, slug: 'rob-run', campaigns: [], seen: 0 }
    ])
    // Rust has campaigns: listing it doesn't add a second Rust.
    expect(games.filter((g) => g.name === 'Rust')).toHaveLength(1)
    expect(groupGames(games, 'list', listOf, NOW)[0]?.games.map((g) => g.name)).toEqual(['Rust'])
  })

  it('finds a game by id, or by name for one only a search knows', () => {
    const games = gamesOf(campaigns)
    expect(findGame(games, 'g-Rust')?.name).toBe('Rust')
    expect(findGame(games, nameId('Pebble Dash'))).toMatchObject({ name: 'Pebble Dash', seen: 0 })
    expect(findGame(games, 'g-unknown')).toBeUndefined()
    expect(findGame(games, 'name:')).toBeUndefined()
  })
})

describe('Twitch page', () => {
  it("is the game's category, or a search for it when the address isn't known", () => {
    expect(twitchPageOf({ name: 'ROBLOX', slug: 'roblox' })).toBe(
      'https://www.twitch.tv/directory/category/roblox'
    )
    expect(twitchPageOf({ name: 'Rob & Run' })).toBe(
      'https://www.twitch.tv/search?term=Rob%20%26%20Run&type=categories'
    )
  })
})

describe('campaign status', () => {
  it('tells an ended campaign with some drops claimed from one with none', () => {
    const ended = (claimed: boolean[]): CampaignView =>
      campaign('c', 'Rust', {
        state: 'expired',
        drops: claimed.map((c, i) => drop({ id: `d${i}`, claimed: c }))
      })
    expect(statusOf(ended([true, true, true]))).toBe('completed')
    expect(statusOf(ended([true, true, true, false]))).toBe('partial')
    expect(statusOf(ended([false, false]))).toBe('missed')
  })

  it('calls a running campaign with every drop claimed completed', () => {
    const running = (claimed: boolean[]): CampaignView =>
      campaign('c', 'Rust', {
        state: 'active',
        drops: claimed.map((c, i) => drop({ id: `d${i}`, claimed: c }))
      })
    expect(statusOf(running([true, true]))).toBe('completed')
    expect(statusOf(running([true, false]))).toBe('active')
    expect(statusOf(running([]))).toBe('active')
  })
})

describe('recently seen', () => {
  it('orders games under a heading by when their campaigns end, soonest first', () => {
    const seenToday = (id: string, game: string, endsAt: string, state: CampaignView['state']) =>
      campaign(id, game, { firstSeenAt: day(18), endsAt, state })
    const games = gamesOf([
      seenToday('a', 'Later', day(28), 'active'),
      seenToday('b', 'Sooner', day(20), 'active'),
      seenToday('c', 'Sooner', day(29), 'upcoming'),
      seenToday('d', 'Ended long ago', day(2), 'expired'),
      seenToday('e', 'Ended lately', day(12), 'expired'),
      seenToday('f', 'Upcoming', day(25), 'upcoming')
    ])
    const [today] = groupGames(games, 'seen', listOf, NOW)
    expect(today?.key).toBe('today')
    expect(today?.games.map((g) => g.name)).toEqual([
      'Sooner',
      'Upcoming',
      'Later',
      'Ended lately',
      'Ended long ago'
    ])
  })

  it('counts the campaigns seen for a game on a list that has none now', () => {
    const games = gamesOf([], { g7: 4 }, ['Palia', 'Rust'], new Map([['Palia', { id: 'g7' }]]))
    expect(games.map((g) => [g.name, g.seen])).toEqual([
      ['Palia', 4],
      ['Rust', 0]
    ])
  })
})
