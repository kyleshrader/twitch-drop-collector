import { DEFAULT_SETTINGS } from '@tdc/config'
import { describe, expect, it } from 'vitest'
import {
  MARVEL,
  NOW,
  RUST,
  campaign,
  channel,
  drop,
  hoursFromNow,
  preferences,
  stream
} from '../domain/builders.test-support'
import { activeCampaign, pickChannel, queuePriority } from '../domain/selection'
import type { Campaign, Game, MiningPreferences } from '../domain/types'
import { buildQueue, neededMinutes, normaliseOrder, queueOptions, type QueueOptions } from './queue'

const ROCKET: Game = { id: '30921', name: 'Rocket League' }
const DEFAULT_OPTIONS = queueOptions(DEFAULT_SETTINGS.queue)

// Tests start from the most permissive rules and set the rule they're about.
const options = (overrides: Partial<QueueOptions> = {}): QueueOptions => ({
  ...DEFAULT_OPTIONS,
  split: 'free',
  campaignProgress: 'separate',
  ...overrides
})
const prefs = (overrides: Partial<MiningPreferences> = {}): MiningPreferences =>
  preferences({ priorityMode: 'endingSoonest', ...overrides })
const ctx = { now: NOW, preferences: { enableBadgesEmotes: false } }

/** A campaign needing `need` hours, ending in `ends` hours. */
function camp(id: string, game: Game, need: number, ends: number, extra: Partial<Campaign> = {}) {
  return campaign({
    id,
    name: id,
    game,
    endsAt: hoursFromNow(ends),
    drops: [drop({ id: `${id}-d`, requiredMinutes: need * 60, endsAt: hoursFromNow(ends) })],
    ...extra
  })
}
const acl = (...logins: string[]): Campaign['allowedChannels'] =>
  logins.map((login) => ({ id: `id-${login}`, login }))

const ids = (q: ReturnType<typeof buildQueue>): string[][] =>
  q.pieces.map((p) => p.entries.map((e) => e.campaign.id))

describe('membership', () => {
  it('queues running campaigns with something left, and lists excluded games apart', () => {
    const q = buildQueue({
      campaigns: [
        camp('rust', RUST, 2, 10),
        camp('rocket', ROCKET, 1, 5),
        camp('ended', RUST, 1, -1),
        camp('upcoming', RUST, 1, 30, { startsAt: hoursFromNow(5) }),
        camp('done', RUST, 1, 10, {
          drops: [drop({ requiredMinutes: 60, realMinutes: 60, claimed: true })]
        }),
        camp('marvel', MARVEL, 1, 10)
      ],
      preferences: prefs({ exclude: ['Marvel Rivals'] }),
      options: options({ sort: 'ending' }),
      ctx
    })
    expect(ids(q)).toEqual([['rocket'], ['rust']])
    expect(q.excluded.map((p) => p.entries.map((e) => e.campaign.id))).toEqual([['marvel']])
  })

  it('keeps campaigns the miner skips, saying why, after the mined ones', () => {
    const q = buildQueue({
      campaigns: [camp('unlinked', ROCKET, 1, 2, { linked: false }), camp('rust', RUST, 3, 40)],
      preferences: prefs(),
      options: options({ sort: 'ending' }),
      ctx
    })
    expect(ids(q)).toEqual([['rust'], ['unlinked']])
    const unlinked = q.pieces[1]!.entries[0]!
    expect(unlinked).toMatchObject({ mined: false, notMined: 'notLinked' })
    expect(unlinked.startsInMinutes).toBeUndefined()
    expect(q.rank.has('unlinked')).toBe(false)

    const unfavoured = buildQueue({
      campaigns: [camp('unlinked', ROCKET, 1, 2, { linked: false }), camp('rust', RUST, 3, 40)],
      preferences: prefs(),
      options: options({ sort: 'ending', linkedFirst: false }),
      ctx
    })
    expect(ids(unfavoured)).toEqual([['unlinked'], ['rust']])
  })

  it('marks Not set games as not mined when only priority games are mined', () => {
    const q = buildQueue({
      campaigns: [camp('rust', RUST, 1, 10), camp('rocket', ROCKET, 1, 10)],
      preferences: prefs({ priority: ['Rust'], priorityMode: 'priorityOnly' }),
      options: options(),
      ctx
    })
    expect(q.pieces.map((p) => [p.game.name, p.list, p.entries[0]!.notMined])).toEqual([
      ['Rust', 'priority', undefined],
      ['Rocket League', 'notSet', 'priorityOnly']
    ])
  })
})

describe('layouts', () => {
  const campaigns = [
    camp('rust-x', RUST, 2, 10, { allowedChannels: acl('x') }),
    camp('rust-y', RUST, 2, 20, { allowedChannels: acl('y') }),
    camp('rust-x2', RUST, 1, 30, { allowedChannels: acl('x') }),
    camp('rocket', ROCKET, 1, 50)
  ]
  const build = (layout: QueueOptions['layout']) =>
    buildQueue({
      campaigns,
      preferences: prefs(),
      options: options({ layout, sort: 'ending' }),
      ctx
    })

  it('games: one card per game, campaigns ending soonest first', () => {
    expect(ids(build('games'))).toEqual([['rust-x', 'rust-y', 'rust-x2'], ['rocket']])
  })

  it('channels: one card per game and allow-list', () => {
    expect(ids(build('channels'))).toEqual([['rust-x', 'rust-x2'], ['rust-y'], ['rocket']])
    expect(build('channels').pieces.map((p) => p.split)).toEqual([true, true, false])
  })

  it('campaigns: one card per campaign', () => {
    expect(ids(build('campaigns'))).toEqual([['rust-x'], ['rust-y'], ['rust-x2'], ['rocket']])
  })
})

describe('sorting', () => {
  const campaigns = [
    camp('rust', RUST, 5, 10),
    camp('rocket', ROCKET, 1, 30),
    camp('marvel', MARVEL, 3, 20)
  ]
  const build = (sort: QueueOptions['sort'], extra: Partial<MiningPreferences> = {}) =>
    ids(buildQueue({ campaigns, preferences: prefs(extra), options: options({ sort }), ctx }))

  it('orders by least time needed, ending soonest, or least time to spare', () => {
    expect(build('priority')).toEqual([['rocket'], ['marvel'], ['rust']])
    expect(build('ending')).toEqual([['rust'], ['marvel'], ['rocket']])
    // Spare: rust 10-5=5, marvel 20-3=17, rocket 30-1=29.
    expect(build('spare')).toEqual([['rust'], ['marvel'], ['rocket']])
  })

  it('puts Priority games first: in list order for the priority sort, as a group otherwise', () => {
    const priority = ['Marvel Rivals', 'Rust']
    expect(build('priority', { priority })).toEqual([['marvel'], ['rust'], ['rocket']])
    expect(build('ending', { priority })).toEqual([['rust'], ['marvel'], ['rocket']])
  })
})

describe('custom order', () => {
  const campaigns = [
    camp('rust-x', RUST, 2, 10, { allowedChannels: acl('x') }),
    camp('rocket', ROCKET, 1, 50),
    camp('rust-y', RUST, 2, 20, { allowedChannels: acl('y') })
  ]
  const custom = (overrides: Partial<QueueOptions>) =>
    buildQueue({
      campaigns,
      preferences: prefs(),
      options: options({ sort: 'custom', ...overrides }),
      ctx
    })

  it('keeps the stored order exactly, so a game splits around another', () => {
    const q = custom({ order: ['rust-x', 'rocket', 'rust-y'] })
    expect(ids(q)).toEqual([['rust-x'], ['rocket'], ['rust-y']])
    expect(q.pieces.map((p) => p.split)).toEqual([true, false, true])
    expect(q.order).toEqual(['rust-x', 'rocket', 'rust-y'])
    expect([...q.rank]).toEqual([
      ['rust-x', 0],
      ['rocket', 1],
      ['rust-y', 2]
    ])
  })

  it('merges pieces of a game that end up next to each other', () => {
    expect(ids(custom({ order: ['rocket', 'rust-y', 'rust-x'] }))).toEqual([
      ['rocket'],
      ['rust-y', 'rust-x']
    ])
  })

  it('slots new campaigns in by time remaining, or at the end, tagged New', () => {
    // rust-y ends in 20 h: after rust-x (10 h), before rocket (50 h).
    const slotted = custom({ order: ['rust-x', 'rocket'] })
    expect(slotted.order).toEqual(['rust-x', 'rust-y', 'rocket'])
    expect(
      slotted.pieces.flatMap((p) => p.entries.filter((e) => e.isNew).map((e) => e.campaign.id))
    ).toEqual(['rust-y'])

    expect(custom({ order: ['rust-x', 'rocket'], newInCustom: 'end' }).order).toEqual([
      'rust-x',
      'rocket',
      'rust-y'
    ])
  })

  it('drops campaigns that left the queue', () => {
    expect(custom({ order: ['gone', 'rust-y', 'rocket', 'rust-x'] }).order).toEqual([
      'rust-y',
      'rocket',
      'rust-x'
    ])
  })

  it('split rules keep what must stay together at the first one’s place', () => {
    const order = ['rust-x', 'rocket', 'rust-y']
    expect(ids(custom({ order, split: 'never' }))).toEqual([['rust-x', 'rust-y'], ['rocket']])
    const sameChannels = [
      camp('a', RUST, 1, 10, { allowedChannels: acl('x') }),
      camp('b', ROCKET, 1, 10),
      camp('c', RUST, 1, 10, { allowedChannels: acl('x') }),
      camp('d', RUST, 1, 10, { allowedChannels: acl('y') })
    ]
    expect(normaliseOrder(sameChannels, 'byChannels').map((c) => c.id)).toEqual([
      'a',
      'c',
      'b',
      'd'
    ])
    expect(normaliseOrder(sameChannels, 'free').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('Collect now', () => {
  it('ranks the focus campaign first in an automatic sort', () => {
    const q = buildQueue({
      campaigns: [camp('rust', RUST, 1, 10), camp('rocket', ROCKET, 5, 30)],
      preferences: prefs(),
      options: options({ sort: 'priority', focus: 'rocket' }),
      ctx
    })
    expect(ids(q)).toEqual([['rocket'], ['rust']])
    expect(q.pieces[0]!.focus).toBe(true)
  })

  it('ignores a focus that is no longer queued or not mined', () => {
    const q = buildQueue({
      campaigns: [camp('rust', RUST, 1, 10), camp('rocket', ROCKET, 5, 30, { linked: false })],
      preferences: prefs(),
      options: options({ focus: 'rocket' }),
      ctx
    })
    expect(ids(q)[0]).toEqual(['rust'])
  })
})

describe('estimates', () => {
  it('needs the longest drop chain, or every drop in turn', () => {
    const c = campaign({
      drops: [
        drop({ id: 'a', requiredMinutes: 60, realMinutes: 30 }),
        drop({ id: 'b', requiredMinutes: 120, realMinutes: 30 })
      ]
    })
    expect(neededMinutes(c, 'together', NOW)).toBe(90)
    expect(neededMinutes(c, 'oneAtATime', NOW)).toBe(120)
  })

  it('plays the queue forward after the current campaign and warns about misses', () => {
    const current = camp('current', RUST, 2, 100)
    const q = buildQueue({
      campaigns: [current, camp('first', ROCKET, 3, 10), camp('late', MARVEL, 4, 7)],
      preferences: prefs(),
      options: options({ sort: 'custom', order: ['current', 'first', 'late'] }),
      ctx,
      current
    })
    expect(ids(q)).toEqual([['first'], ['late']])
    expect(q.currentNeedMinutes).toBe(120)
    const [first, late] = q.pieces.map((p) => p.entries[0]!)
    expect(first).toMatchObject({ startsInMinutes: 120, needMinutes: 180 })
    expect(first!.warning).toBeUndefined()
    // Starts after 5 h, needs 4 h, ends in 7 h; at the top (after Current's 2 h) it would make it.
    expect(late).toMatchObject({ startsInMinutes: 300, warning: { savedAtTop: true } })
  })

  it('says when even the top wouldn’t save it', () => {
    const q = buildQueue({
      campaigns: [camp('rocket', ROCKET, 1, 2), camp('rust', RUST, 9, 5)],
      preferences: prefs(),
      options: options({ sort: 'ending' }),
      ctx
    })
    expect(q.pieces[1]!.entries[0]!.warning).toEqual({ savedAtTop: false })
  })

  it('with campaigns progressing together, credits same-game campaigns on a shared channel', () => {
    const campaigns = [
      camp('rust-a', RUST, 3, 100),
      camp('rocket', ROCKET, 1, 100),
      camp('rust-b', RUST, 4, 100),
      camp('rust-other', RUST, 2, 100, { allowedChannels: acl('z') })
    ]
    const order = ['rust-a', 'rocket', 'rust-b', 'rust-other']
    const build = (campaignProgress: QueueOptions['campaignProgress']) =>
      buildQueue({
        campaigns,
        preferences: prefs(),
        options: options({ sort: 'custom', order, campaignProgress }),
        ctx
      }).pieces.flatMap((p) => p.entries)

    const separate = build('separate')
    expect(separate.map((e) => e.startsInMinutes)).toEqual([0, 180, 240, 480])
    const together = build('together')
    // rust-b got rust-a's 3 h; rust-other (channel z) shares rust-a's and rust-b's any-channel.
    expect(together.map((e) => e.startsInMinutes)).toEqual([0, 180, 240, 300])
    expect(together[2]!.progressesWith).toEqual(['rust-a'])
    expect(together[3]!.progressesWith).toEqual(['rust-a', 'rust-b'])
  })
})

describe('the miner follows the queue', () => {
  it('ranks channels and the progressing campaign by queue position', () => {
    const x = channel({ id: 'id-x', login: 'x', aclBased: true, stream: stream({ game: RUST }) })
    const rocketChannel = channel({ id: 'r', login: 'r', stream: stream({ game: ROCKET }) })
    const campaigns = [
      camp('rust-x', RUST, 2, 10, { allowedChannels: acl('x') }),
      camp('rocket', ROCKET, 1, 50),
      camp('rust-any', RUST, 1, 60)
    ]
    const q = buildQueue({
      campaigns,
      preferences: prefs(),
      options: options({ sort: 'custom', order: ['rocket', 'rust-x', 'rust-any'] }),
      ctx
    })
    const wanted = [RUST, ROCKET]
    expect(queuePriority(x, campaigns, q.rank, ctx)).toBe(1)
    expect(queuePriority(rocketChannel, campaigns, q.rank, ctx)).toBe(0)
    // Game priority alone would pick Rust; the queue puts Rocket League first.
    expect(pickChannel({ channels: [x, rocketChannel], campaigns, wanted, ctx }).channel?.id).toBe(
      'id-x'
    )
    expect(
      pickChannel({ channels: [x, rocketChannel], campaigns, wanted, ctx, rank: q.rank }).channel
        ?.id
    ).toBe('r')
    // On x both Rust campaigns progress; the queue ranks rust-x higher, minutes alone rust-any.
    expect(activeCampaign(x, campaigns, wanted, ctx)?.id).toBe('rust-any')
    expect(activeCampaign(x, campaigns, wanted, ctx, q.rank)?.id).toBe('rust-x')
  })
})

describe('the recommended rules (the defaults)', () => {
  it('keep same-channel campaigns together, split by channel list, and share watch time', () => {
    const campaigns = [
      camp('rust-a', RUST, 3, 100),
      camp('rocket', ROCKET, 1, 100),
      camp('rust-b', RUST, 4, 100),
      camp('rust-x', RUST, 2, 100, { allowedChannels: acl('x') })
    ]
    const q = buildQueue({
      campaigns,
      preferences: prefs(),
      options: {
        ...DEFAULT_OPTIONS,
        sort: 'custom',
        order: ['rust-a', 'rocket', 'rust-x', 'rust-b']
      },
      ctx
    })
    // rust-b accepts the same channels as rust-a, so it can't be held back behind Rocket League;
    // rust-x has its own channel list, so it can.
    expect(ids(q)).toEqual([['rust-a', 'rust-b'], ['rocket'], ['rust-x']])
    // Watching rust-a's channels counts for rust-b (4 h - 3 h = 1 h left) and for rust-x
    // (channel x streams Rust, which rust-a accepts too).
    const entries = q.pieces.flatMap((p) => p.entries)
    expect(entries.map((e) => [e.campaign.id, e.startsInMinutes])).toEqual([
      ['rust-a', 0],
      ['rust-b', 180],
      ['rocket', 240],
      ['rust-x', 300]
    ])
    expect(entries[1]!.progressesWith).toEqual(['rust-a'])
  })
})
