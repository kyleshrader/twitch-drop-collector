// The History page's sums and groups, apart from the page so they can be tested: what's in the
// chosen range and filter, the totals, the games, and the days.
import type { HistoryEntryView } from '@tdc/ipc-contract'

export type HistoryRange = '7d' | '30d' | '90d' | 'all'
export const HISTORY_RANGES: readonly HistoryRange[] = ['7d', '30d', '90d', 'all']
/**
 * What the page shows: everything, or one kind. Campaigns: new, started and ended ones. Library:
 * new games, list changes and linked accounts, and the app's own pauses and updates.
 */
export type HistoryFilter = 'all' | 'claims' | 'watching' | 'campaigns' | 'library'
export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  'all',
  'claims',
  'watching',
  'campaigns',
  'library'
]

const DAY = 24 * 60 * 60 * 1000
const RANGE_DAYS: Readonly<Record<Exclude<HistoryRange, 'all'>, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
}

/** The start of the range: midnight, so "7 days" is today and the six days before. */
export function rangeStart(range: HistoryRange, now: number): number {
  if (range === 'all') return -Infinity
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1))
  return start.getTime()
}

const kindsOf: Readonly<Record<HistoryFilter, readonly HistoryEntryView['kind'][]>> = {
  all: ['claim', 'watch', 'ended', 'new', 'started', 'newGame', 'list', 'linked', 'app'],
  claims: ['claim'],
  watching: ['watch'],
  campaigns: ['ended', 'new', 'started'],
  library: ['newGame', 'list', 'linked', 'app']
}

/** The game an entry is about (app events have none). */
export const gameOf = (e: HistoryEntryView): string | undefined =>
  'game' in e ? e.game : undefined

/** Everything an entry can be found by: game, campaign, drop, rewards, channel. */
export function searchText(e: HistoryEntryView): string {
  const parts: string[] = [gameOf(e) ?? '']
  if (e.kind === 'claim') parts.push(e.campaign ?? '', e.drop, ...e.rewards)
  if (e.kind === 'watch') parts.push(e.channelName, e.channelLogin, e.campaign ?? '')
  if (e.kind === 'ended') parts.push(e.campaign)
  if (e.kind === 'new' || e.kind === 'newGame') parts.push(...e.campaigns.map((c) => c.name))
  if (e.kind === 'started') parts.push(e.campaign)
  if (e.kind === 'app') parts.push(e.event, e.version ?? '')
  return parts.join('\n').toLowerCase()
}

export interface HistoryQuery {
  range: HistoryRange
  filter: HistoryFilter
  /** Free text; every word must match. */
  text: string
  /** Only this game. */
  game?: string | undefined
  now: number
}

/** The entries in the range that match the search and game, of any kind (for the totals). */
export function inScope(
  entries: readonly HistoryEntryView[],
  q: Omit<HistoryQuery, 'filter'>
): HistoryEntryView[] {
  const from = rangeStart(q.range, q.now)
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(
    (e) =>
      Date.parse(e.kind === 'watch' ? e.endedAt : e.at) >= from &&
      (q.game === undefined || gameOf(e) === q.game) &&
      words.every((w) => searchText(e).includes(w))
  )
}

/** What the list shows: the entries in scope, of the filter's kinds. */
export function visibleEntries(
  entries: readonly HistoryEntryView[],
  q: HistoryQuery
): HistoryEntryView[] {
  const kinds = kindsOf[q.filter]
  return inScope(entries, q).filter((e) => kinds.includes(e.kind))
}

export interface GameTotal {
  game: string
  minutes: number
  drops: number
}

export interface HistoryTotals {
  drops: number
  minutes: number
  /** Ended campaigns, and of those: all drops claimed, some, none though earnable. */
  ended: number
  completed: number
  partial: number
  missed: number
  /** Games by time watched, then drops claimed. */
  games: GameTotal[]
}

export function totalsOf(entries: readonly HistoryEntryView[]): HistoryTotals {
  const games = new Map<string, GameTotal>()
  const game = (name: string): GameTotal => {
    const known = games.get(name) ?? { game: name, minutes: 0, drops: 0 }
    games.set(name, known)
    return known
  }
  const totals: HistoryTotals = {
    drops: 0,
    minutes: 0,
    ended: 0,
    completed: 0,
    partial: 0,
    missed: 0,
    games: []
  }
  for (const e of entries) {
    if (e.kind === 'claim') {
      totals.drops += 1
      game(e.game).drops += 1
    } else if (e.kind === 'watch') {
      totals.minutes += e.minutes
      game(e.game).minutes += e.minutes
    } else if (e.kind === 'ended') {
      totals.ended += 1
      if (e.outcome === 'completed') totals.completed += 1
      if (e.outcome === 'partial') totals.partial += 1
      if (e.outcome === 'missed') totals.missed += 1
    }
  }
  totals.games = [...games.values()].sort(
    (a, b) => b.minutes - a.minutes || b.drops - a.drops || a.game.localeCompare(b.game)
  )
  return totals
}

export interface HistoryDay {
  /** Local midnight. */
  start: number
  entries: HistoryEntryView[]
  drops: number
  minutes: number
}

/** Entries (newest first) by local day; a watch session belongs to the day it started. */
export function byDay(entries: readonly HistoryEntryView[]): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const e of entries) {
    const midnight = new Date(e.at)
    midnight.setHours(0, 0, 0, 0)
    const start = midnight.getTime()
    let day = days.at(-1)
    if (day?.start !== start) {
      day = { start, entries: [], drops: 0, minutes: 0 }
      days.push(day)
    }
    day.entries.push(e)
    if (e.kind === 'claim') day.drops += 1
    if (e.kind === 'watch') day.minutes += e.minutes
  }
  return days
}

/** Days apart from today: 0 today, 1 yesterday. */
export function daysAgo(start: number, now: number): number {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - start) / DAY)
}
