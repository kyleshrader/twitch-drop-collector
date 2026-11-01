// Inventory filters, shop-style: each category (facet) has options to tick. Nothing ticked in a
// category means it doesn't filter, so by default everything shows. Options in one category
// combine with "or", categories with "and". Pure functions, so they're unit-tested.
import type { CampaignView } from '@tdc/ipc-contract'

export const FACETS = ['status', 'game', 'list', 'account', 'progress', 'rewards'] as const
export type Facet = (typeof FACETS)[number]

export interface InventoryFilters {
  /** Matches game or campaign names, ignoring case. */
  search: string
  /** Ticked options per category. */
  selected: Record<Facet, readonly string[]>
}

export const NO_FILTERS: InventoryFilters = {
  search: '',
  selected: { status: [], game: [], list: [], account: [], progress: [], rewards: [] }
}

/** The priority and excluded games from settings, which the "list" category follows. */
export interface GameLists {
  priority: readonly string[]
  exclude: readonly string[]
}

/** Where a game stands on the user's lists. Excluded wins, as it does for the miner. */
export const listOf = (game: string, lists: GameLists): 'excluded' | 'priority' | 'neither' =>
  lists.exclude.includes(game) ? 'excluded' : lists.priority.includes(game) ? 'priority' : 'neither'

/** The option of each category that a campaign falls under. */
export const optionOf: Record<Facet, (c: CampaignView, lists: GameLists) => string> = {
  status: (c) => c.state,
  game: (c) => c.game,
  list: (c, lists) => listOf(c.game, lists),
  // Badge and emote campaigns can be claimed without a linked game account.
  account: (c) => (c.linked ? 'linked' : c.badgesEmotes ? 'notNeeded' : 'notLinked'),
  progress: (c) =>
    c.drops.every((d) => d.claimed)
      ? 'finished'
      : c.drops.some((d) => d.claimed || d.minutes > 0)
        ? 'inProgress'
        : 'notStarted',
  rewards: (c) => (c.badgesEmotes ? 'badgesEmotes' : 'items')
}

/** Categories with a fixed set of options, in display order. Games come from the campaigns. */
export const FIXED_OPTIONS = {
  status: ['active', 'upcoming', 'expired'],
  list: ['priority', 'excluded', 'neither'],
  account: ['linked', 'notLinked', 'notNeeded'],
  progress: ['notStarted', 'inProgress', 'finished'],
  rewards: ['items', 'badgesEmotes']
} as const satisfies Partial<Record<Facet, readonly string[]>>

export function matchesSearch(c: CampaignView, search: string): boolean {
  const query = search.trim().toLowerCase()
  return query === '' || `${c.game}\n${c.name}`.toLowerCase().includes(query)
}

/** Passes the search and every category's ticks (except `ignoring`, for counting). */
function matches(
  c: CampaignView,
  filters: InventoryFilters,
  lists: GameLists,
  ignoring?: Facet
): boolean {
  return (
    matchesSearch(c, filters.search) &&
    FACETS.every((facet) => {
      const ticked = filters.selected[facet]
      return facet === ignoring || ticked.length === 0 || ticked.includes(optionOf[facet](c, lists))
    })
  )
}

export function applyFilters(
  campaigns: readonly CampaignView[],
  filters: InventoryFilters,
  lists: GameLists
): CampaignView[] {
  return campaigns.filter((c) => matches(c, filters, lists))
}

export interface FacetOption {
  key: string
  /** Campaigns this option would show, given the search and the other categories' ticks. */
  count: number
  selected: boolean
}

/**
 * A category's options with their counts. Fixed categories list every option; games list those
 * with campaigns (or ticked), most campaigns first.
 */
export function facetOptions(
  facet: Facet,
  campaigns: readonly CampaignView[],
  filters: InventoryFilters,
  lists: GameLists
): FacetOption[] {
  const counts = new Map<string, number>()
  for (const c of campaigns) {
    if (!matches(c, filters, lists, facet)) continue
    const key = optionOf[facet](c, lists)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ticked = filters.selected[facet]
  const option = (key: string): FacetOption => ({
    key,
    count: counts.get(key) ?? 0,
    selected: ticked.includes(key)
  })
  if (facet !== 'game') return FIXED_OPTIONS[facet].map(option)
  const keys = new Set([...counts.keys(), ...ticked])
  return [...keys].map(option).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function toggle(filters: InventoryFilters, facet: Facet, key: string): InventoryFilters {
  const ticked = filters.selected[facet]
  const next = ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key]
  return { ...filters, selected: { ...filters.selected, [facet]: next } }
}

export const clearFacet = (filters: InventoryFilters, facet: Facet): InventoryFilters => ({
  ...filters,
  selected: { ...filters.selected, [facet]: [] }
})

export const isFiltered = (filters: InventoryFilters): boolean =>
  filters.search.trim() !== '' || FACETS.some((f) => filters.selected[f].length > 0)
