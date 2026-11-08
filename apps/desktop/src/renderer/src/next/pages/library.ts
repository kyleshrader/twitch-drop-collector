// The Library's games: built from the campaigns in the miner view and the app's own history,
// then filtered, sorted and grouped (with date headings for the time-based sorts). Pure, so it's
// unit-tested apart from the page.
import type { CampaignView } from '@tdc/ipc-contract'
import type { ListChoice } from '../data'
import { DATE_BUCKETS, dateBucket, type DateBucket } from '../format'

export type Sorting = 'list' | 'account' | 'name' | 'seen' | 'claimed'
export const SORTINGS: readonly Sorting[] = ['list', 'account', 'name', 'seen', 'claimed']
export type Account = 'linked' | 'notLinked' | 'notNeeded'
export type CampaignStatus =
  'active' | 'upcoming' | 'unclaimed' | 'completed' | 'partial' | 'missed'
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'upcoming',
  'unclaimed',
  'completed',
  'partial',
  'missed'
]
/** The quick filters beside the collection menu. */
export type Filter = 'hideExcluded' | 'active' | 'recentlyClaimed' | 'unclaimed'
export const FILTERS: readonly Filter[] = ['hideExcluded', 'active', 'recentlyClaimed', 'unclaimed']
/** "Recently claimed" means within this many days. */
export const RECENT_DAYS = 7

export interface LibraryGame {
  id: string
  name: string
  boxArtUrl?: string
  /** Its address on Twitch, when known. */
  slug?: string
  linkUrl?: string
  /** The campaigns Twitch lists now. */
  campaigns: CampaignView[]
  /** Every campaign the app has seen for the game, including ones Twitch no longer lists. */
  seen: number
  /** When the newest campaign was first seen. */
  lastSeenAt?: string
  /** When a drop was last claimed. */
  lastClaimedAt?: string
}

const latest = (times: readonly (string | undefined)[]): string | undefined =>
  times.reduce<string | undefined>(
    (best, at) => (at && (!best || at > best) ? at : best),
    undefined
  )

/** What a search told us about a game, by name: lists hold names only. */
export interface KnownGame {
  boxArtUrl?: string
  slug?: string
}

/** The id of a game known only by name: on a list, or found by a search, without campaigns. */
export const nameId = (name: string): string => `name:${name}`

/** A game without campaigns, known only by name (and what a search found about it). */
export function gameFromName(name: string, known: KnownGame = {}): LibraryGame {
  return {
    id: nameId(name),
    name,
    ...(known.boxArtUrl ? { boxArtUrl: known.boxArtUrl } : {}),
    ...(known.slug ? { slug: known.slug } : {}),
    campaigns: [],
    seen: 0
  }
}

/** The game an address names: one in the Library, or one known only by name. */
export function findGame(
  games: readonly LibraryGame[],
  id: string,
  known: ReadonlyMap<string, KnownGame> = new Map()
): LibraryGame | undefined {
  const found = games.find((g) => g.id === id)
  if (found || !id.startsWith('name:')) return found
  const name = id.slice('name:'.length)
  return name ? gameFromName(name, known.get(name)) : undefined
}

/**
 * Twitch's page for a game: its category (twitch.tv/directory/category/<slug>), or a search for
 * its name when the slug isn't known.
 */
export function twitchPageOf(game: Pick<LibraryGame, 'name' | 'slug'>): string {
  return game.slug
    ? `https://www.twitch.tv/directory/category/${encodeURIComponent(game.slug)}`
    : `https://www.twitch.tv/search?term=${encodeURIComponent(game.name)}&type=categories`
}

/**
 * Every game with campaigns, plus the games on the priority and excluded lists that have none
 * (games without drops the user still wants to rank or skip). `known` is what searches found
 * about those, by name.
 */
export function gamesOf(
  campaigns: readonly CampaignView[],
  seenByGame: Readonly<Record<string, number>> = {},
  listed: readonly string[] = [],
  known: ReadonlyMap<string, KnownGame> = new Map()
): LibraryGame[] {
  const byId = new Map<string, CampaignView[]>()
  for (const c of campaigns) byId.set(c.gameId, [...(byId.get(c.gameId) ?? []), c])
  const withCampaigns = new Set(campaigns.map((c) => c.game))
  const nameOnly = [...new Set(listed)]
    .filter((name) => !withCampaigns.has(name))
    .map((name) => gameFromName(name, known.get(name)))
  return [...byId.entries()]
    .map(([id, list]): LibraryGame => {
      const saved = known.get(list[0]!.game)
      const boxArtUrl = list.find((c) => c.boxArtUrl)?.boxArtUrl ?? saved?.boxArtUrl
      const slug = list.find((c) => c.gameSlug)?.gameSlug ?? saved?.slug
      const linkUrl = list.find((c) => c.linkUrl)?.linkUrl
      const lastSeenAt = latest(list.map((c) => c.firstSeenAt))
      const lastClaimedAt = latest(list.flatMap((c) => c.drops.map((d) => d.claimedAt)))
      return {
        id,
        name: list[0]!.game,
        ...(boxArtUrl ? { boxArtUrl } : {}),
        ...(slug ? { slug } : {}),
        ...(linkUrl ? { linkUrl } : {}),
        campaigns: list,
        seen: Math.max(seenByGame[id] ?? 0, list.length),
        ...(lastSeenAt ? { lastSeenAt } : {}),
        ...(lastClaimedAt ? { lastClaimedAt } : {})
      }
    })
    .concat(nameOnly)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function statusOf(c: CampaignView): CampaignStatus {
  if (c.drops.some((d) => d.awaitsConnection)) return 'unclaimed'
  if (c.state === 'active') return 'active'
  if (c.state === 'upcoming') return 'upcoming'
  // Ended: every drop claimed, some of them, or none.
  const claimed = c.drops.filter((d) => d.claimed).length
  if (claimed === c.drops.length) return 'completed'
  return claimed > 0 ? 'partial' : 'missed'
}

export function accountOf(game: LibraryGame): Account {
  if (game.campaigns.every((c) => c.badgesEmotes)) return 'notNeeded'
  return game.campaigns.some((c) => c.linked) ? 'linked' : 'notLinked'
}

export const countStatus = (game: LibraryGame, status: CampaignStatus): number =>
  game.campaigns.filter((c) => statusOf(c) === status).length

/** How many campaigns are in each state, plus the ones Twitch no longer lists. */
export function breakdown(game: LibraryGame): {
  counts: Partial<Record<CampaignStatus, number>>
  unlisted: number
} {
  const counts: Partial<Record<CampaignStatus, number>> = {}
  for (const status of CAMPAIGN_STATUSES) {
    const n = countStatus(game, status)
    if (n > 0) counts[status] = n
  }
  return { counts, unlisted: game.seen - game.campaigns.length }
}

export function applyFilters(
  games: readonly LibraryGame[],
  filters: ReadonlySet<Filter>,
  listOf: (game: string) => ListChoice,
  now: number
): LibraryGame[] {
  const recent = now - RECENT_DAYS * 24 * 3_600_000
  return games.filter(
    (g) =>
      (!filters.has('hideExcluded') || listOf(g.name) !== 'excluded') &&
      (!filters.has('active') || countStatus(g, 'active') > 0) &&
      (!filters.has('unclaimed') || countStatus(g, 'unclaimed') > 0) &&
      (!filters.has('recentlyClaimed') ||
        (g.lastClaimedAt !== undefined && Date.parse(g.lastClaimedAt) >= recent))
  )
}

/** A heading's key: a list or account state, a date bucket, or one of the catch-alls. */
export type GroupKey = ListChoice | Account | DateBucket | 'all' | 'neverClaimed'

export interface GameGroup {
  key: GroupKey
  games: LibraryGame[]
}

/**
 * Games by when their campaigns end: the soonest end among campaigns still running or to come
 * first; games with only ended campaigns after them, most recently ended first.
 */
export function byCampaignEnd(a: LibraryGame, b: LibraryGame): number {
  const open = (g: LibraryGame): string[] =>
    g.campaigns.filter((c) => c.state !== 'expired').map((c) => c.endsAt)
  const soonest = (g: LibraryGame): string | undefined => open(g).sort()[0]
  const lastEnded = (g: LibraryGame): string =>
    g.campaigns
      .map((c) => c.endsAt)
      .sort()
      .at(-1) ?? ''
  const [sa, sb] = [soonest(a), soonest(b)]
  if (sa && sb) return sa.localeCompare(sb) || a.name.localeCompare(b.name)
  if (sa || sb) return sa ? -1 : 1
  return lastEnded(b).localeCompare(lastEnded(a)) || a.name.localeCompare(b.name)
}

function byDate(
  games: readonly LibraryGame[],
  timeOf: (g: LibraryGame) => string | undefined,
  now: number,
  missing: GroupKey,
  /** Order inside a heading (default: newest time first). */
  order: (a: LibraryGame, b: LibraryGame) => number = (a, b) =>
    (timeOf(b) ?? '').localeCompare(timeOf(a) ?? '') || a.name.localeCompare(b.name)
): GameGroup[] {
  const sorted = [...games].sort(order)
  const groups: GameGroup[] = DATE_BUCKETS.map((key) => ({
    key,
    games: sorted.filter((g) => {
      const at = timeOf(g)
      return at !== undefined && dateBucket(at, now) === key
    })
  }))
  const undated = sorted.filter((g) => timeOf(g) === undefined)
  const same = groups.find((g) => g.key === missing)
  if (same) same.games.push(...undated)
  else groups.push({ key: missing, games: undated })
  return groups.filter((g) => g.games.length > 0)
}

export function groupGames(
  games: readonly LibraryGame[],
  sorting: Sorting,
  listOf: (game: string) => ListChoice,
  now: number
): GameGroup[] {
  if (sorting === 'name') return games.length ? [{ key: 'all', games: [...games] }] : []
  // Headed by when games were first seen; inside a heading, by when their campaigns end. Games
  // not seen since the history started count as seen long ago.
  if (sorting === 'seen') return byDate(games, (g) => g.lastSeenAt, now, 'older', byCampaignEnd)
  if (sorting === 'claimed') return byDate(games, (g) => g.lastClaimedAt, now, 'neverClaimed')
  const keys: readonly GroupKey[] =
    sorting === 'list'
      ? (['priority', 'notSet', 'excluded'] as const)
      : (['linked', 'notLinked', 'notNeeded'] as const)
  const keyOf = (g: LibraryGame): GroupKey => (sorting === 'list' ? listOf(g.name) : accountOf(g))
  return keys
    .map((key) => ({ key, games: games.filter((g) => keyOf(g) === key) }))
    .filter((g) => g.games.length > 0)
}
