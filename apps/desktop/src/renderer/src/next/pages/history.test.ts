import type { HistoryEntryView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import { byDay, daysAgo, gameOf, inScope, rangeStart, totalsOf, visibleEntries } from './history'

const local = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime()
const iso = (t: number): string => new Date(t).toISOString()
const NOW = local(2026, 11, 10, 15)

const claim = (t: number, game = 'Rust', reward = 'Hoodie'): HistoryEntryView => ({
  kind: 'claim',
  id: `claim:${t}:${reward}`,
  at: iso(t),
  game,
  campaignId: 'c',
  campaign: 'Rust Week',
  drop: reward,
  rewards: [reward]
})
const watch = (t: number, minutes: number, game = 'Rust'): HistoryEntryView => ({
  kind: 'watch',
  id: `watch:${t}`,
  at: iso(t),
  endedAt: iso(t + minutes * 60_000),
  minutes,
  game,
  channelLogin: 'xqc',
  channelName: 'xQc'
})
const ended = (
  t: number,
  outcome: 'completed' | 'partial' | 'missed' | 'notEarnable'
): HistoryEntryView => ({
  kind: 'ended',
  id: `ended:${t}:${outcome}`,
  at: iso(t),
  game: 'Rust',
  campaignId: outcome,
  campaign: `Rust ${outcome}`,
  claimed: 0,
  total: 3,
  outcome,
  watchedMinutes: 0
})

describe('the History page', () => {
  it('starts a range at midnight, counting today as one of its days', () => {
    expect(rangeStart('7d', NOW)).toBe(local(2026, 11, 4, 0))
    expect(rangeStart('all', NOW)).toBe(-Infinity)
  })

  it('finds entries by any word, in range, and by game', () => {
    const entries = [
      claim(local(2026, 11, 10, 9), 'Rust', 'Pirate Parrot'),
      watch(local(2026, 11, 9, 20), 60, 'Rocket League'),
      claim(local(2026, 10, 1), 'Rust', 'Old Hat')
    ]
    const q = { range: '7d' as const, text: '', now: NOW }
    expect(inScope(entries, q)).toHaveLength(2)
    expect(inScope(entries, { ...q, text: 'parrot RUST' }).map((e) => e.id)).toEqual([
      entries[0]!.id
    ])
    expect(inScope(entries, { ...q, text: 'xqc' }).map(gameOf)).toEqual(['Rocket League'])
    expect(inScope(entries, { ...q, range: 'all', game: 'Rust' })).toHaveLength(2)
    expect(visibleEntries(entries, { ...q, filter: 'watching' }).map((e) => e.kind)).toEqual([
      'watch'
    ])
  })

  it('keeps a watch session that ran into the range', () => {
    const late = watch(local(2026, 11, 3, 23), 120)
    expect(inScope([late], { range: '7d', text: '', now: NOW })).toHaveLength(1)
  })

  it('adds up drops, time watched, campaign outcomes and games', () => {
    const totals = totalsOf([
      claim(1, 'Rust'),
      claim(2, 'Rocket League'),
      claim(3, 'Rocket League'),
      watch(4, 90, 'Rust'),
      watch(5, 30, 'Rust'),
      ended(6, 'completed'),
      ended(7, 'missed'),
      ended(8, 'partial'),
      ended(9, 'notEarnable')
    ])
    expect(totals).toMatchObject({
      drops: 3,
      minutes: 120,
      ended: 4,
      completed: 1,
      partial: 1,
      missed: 1
    })
    expect(totals.games).toEqual([
      { game: 'Rust', minutes: 120, drops: 1 },
      { game: 'Rocket League', minutes: 0, drops: 2 }
    ])
  })

  it('groups by local day, with each day’s drops and time watched', () => {
    const days = byDay([
      claim(local(2026, 11, 10, 14)),
      watch(local(2026, 11, 10, 9), 45),
      watch(local(2026, 11, 9, 23, 30), 60),
      claim(local(2026, 11, 7, 8))
    ])
    expect(days.map((d) => [daysAgo(d.start, NOW), d.entries.length, d.drops, d.minutes])).toEqual([
      [0, 2, 1, 45],
      [1, 1, 0, 60],
      [3, 1, 1, 0]
    ])
  })
})
