import type { CampaignView } from '@tdc/ipc-contract'
import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  clearFacet,
  facetOptions,
  isFiltered,
  listOf,
  NO_FILTERS,
  optionOf,
  toggle,
  type GameLists,
  type InventoryFilters
} from './inventory-filters'

const drop = (claimed: boolean, minutes = 0): CampaignView['drops'][number] => ({
  id: `d-${claimed}-${minutes}`,
  name: 'Drop',
  minutes,
  requiredMinutes: 60,
  claimed,
  awaitsConnection: false,
  rewards: [],
  startsAt: '2026-10-30T00:00:00.000Z',
  endsAt: '2026-11-30T00:00:00.000Z'
})

const campaign = (id: string, overrides: Partial<CampaignView> = {}): CampaignView => ({
  id,
  name: `Campaign ${id}`,
  game: 'Rust',
  state: 'active',
  linked: true,
  startsAt: '2026-10-30T00:00:00.000Z',
  endsAt: '2026-11-30T00:00:00.000Z',
  allowListed: false,
  badgesEmotes: false,
  drops: [drop(false)],
  ...overrides
})

const campaigns = [
  campaign('rust-new'),
  campaign('rust-going', { drops: [drop(false, 20)] }),
  campaign('rust-done', { drops: [drop(true), drop(true)] }),
  campaign('rust-ended', { state: 'expired' }),
  campaign('marvel-soon', { state: 'upcoming', game: 'Marvel Rivals' }),
  campaign('darker', { game: 'Dark and Darker', linked: false }),
  campaign('emotes', { game: 'Marvel Rivals', linked: false, badgesEmotes: true, name: 'Emotes' })
]
const LISTS: GameLists = { priority: ['Marvel Rivals', 'Rust'], exclude: ['Dark and Darker'] }
const ids = (filters: InventoryFilters, lists: GameLists = LISTS): string[] =>
  applyFilters(campaigns, filters, lists).map((c) => c.id)
const tick = (...pairs: [Parameters<typeof toggle>[1], string][]): InventoryFilters =>
  pairs.reduce((f, [facet, key]) => toggle(f, facet, key), NO_FILTERS)

describe('inventory filters', () => {
  it('shows everything when nothing is ticked', () => {
    expect(ids(NO_FILTERS)).toEqual(campaigns.map((c) => c.id))
    expect(isFiltered(NO_FILTERS)).toBe(false)
  })

  it('places each campaign under one option per category', () => {
    const emotes = campaigns.at(-1)!
    expect(optionOf.account(emotes, LISTS)).toBe('notNeeded')
    expect(optionOf.account(campaigns[5]!, LISTS)).toBe('notLinked')
    expect(optionOf.rewards(emotes, LISTS)).toBe('badgesEmotes')
    expect(campaigns.slice(0, 3).map((c) => optionOf.progress(c, LISTS))).toEqual([
      'notStarted',
      'inProgress',
      'finished'
    ])
  })

  it('combines options in a category with "or", and categories with "and"', () => {
    expect(ids(tick(['status', 'upcoming'], ['status', 'expired']))).toEqual([
      'rust-ended',
      'marvel-soon'
    ])
    expect(ids(tick(['game', 'Rust'], ['progress', 'finished']))).toEqual(['rust-done'])
  })

  it('follows the priority and excluded lists from settings', () => {
    expect(ids(tick(['list', 'priority']))).toEqual([
      'rust-new',
      'rust-going',
      'rust-done',
      'rust-ended',
      'marvel-soon',
      'emotes'
    ])
    expect(ids(tick(['list', 'excluded']))).toEqual(['darker'])
    expect(ids(tick(['list', 'neither']), { priority: [], exclude: [] })).toHaveLength(7)
    expect(facetOptions('list', campaigns, NO_FILTERS, LISTS)).toEqual([
      { key: 'priority', count: 6, selected: false },
      { key: 'excluded', count: 1, selected: false },
      { key: 'neither', count: 0, selected: false }
    ])
  })

  it('treats a game on both lists as excluded, as the miner does', () => {
    expect(listOf('Rust', { priority: ['Rust'], exclude: ['Rust'] })).toBe('excluded')
  })

  it('searches game and campaign names, ignoring case', () => {
    expect(ids({ ...NO_FILTERS, search: '  DARK ' })).toEqual(['darker'])
    expect(ids({ ...NO_FILTERS, search: 'emotes' })).toEqual(['emotes'])
  })

  it('counts each option against the other categories, not its own', () => {
    const filters = tick(['status', 'active'], ['game', 'Rust'])
    expect(facetOptions('status', campaigns, filters, LISTS)).toEqual([
      { key: 'active', count: 3, selected: true },
      { key: 'upcoming', count: 0, selected: false },
      { key: 'expired', count: 1, selected: false }
    ])
    // Active campaigns per game, most first; a ticked game stays listed.
    expect(facetOptions('game', campaigns, filters, LISTS)).toEqual([
      { key: 'Rust', count: 3, selected: true },
      { key: 'Dark and Darker', count: 1, selected: false },
      { key: 'Marvel Rivals', count: 1, selected: false }
    ])
  })

  it('keeps a ticked game listed even when nothing matches it any more', () => {
    const filters = { ...tick(['game', 'Rust']), search: 'marvel' }
    expect(facetOptions('game', campaigns, filters, LISTS)).toContainEqual({
      key: 'Rust',
      count: 0,
      selected: true
    })
  })

  it('unticks and clears', () => {
    const filters = tick(['status', 'active'], ['status', 'upcoming'])
    expect(toggle(filters, 'status', 'active').selected.status).toEqual(['upcoming'])
    expect(clearFacet(filters, 'status').selected.status).toEqual([])
    expect(isFiltered(filters)).toBe(true)
  })
})
