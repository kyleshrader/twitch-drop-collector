// What the app knows about games, by name: Twitch's ID, the address of the game's page and its
// box art. Campaigns bring it for their games; games without campaigns (put on a list from a
// search) are looked up by name. Everything is saved, so a game page keeps its picture and its
// "View on Twitch" link across restarts, and refreshed over time, since box art changes.
import { gql as operations, type GqlClient } from '@tdc/api'
import type { Campaign } from '@tdc/core'
import { withoutImageSize } from '@tdc/core'
import type { Clock, Logger } from '@tdc/kernel'
import type { GameInfo, Games } from '@tdc/storage'

/** A game's saved info is looked up again after this long. */
export const GAME_INFO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** At most this many games are looked up at a time (a few GQL batches). */
const LOOKUPS_PER_ROUND = 60

export interface KnownGame {
  id?: string
  slug?: string
  boxArtUrl?: string
}

export interface GameInfoService {
  /** Saves the games campaigns name; only what changed is written. */
  fromCampaigns(campaigns: readonly Campaign[]): void
  /** Looks up the named games that are missing, incomplete or stale. */
  refresh(names: readonly string[]): Promise<void>
  /** Everything known, by name. */
  known(): Readonly<Record<string, KnownGame>>
  onChange(listener: () => void): () => void
}

/** Whether a saved game needs looking up: unknown, missing its address or art, or old. */
export function needsLookup(info: GameInfo | undefined, now: Date): boolean {
  if (!info) return true
  const stale = now.getTime() - info.checkedAt.getTime() > GAME_INFO_MAX_AGE_MS
  // A game Twitch didn't find (no ID) is retried only when stale, not every round.
  if (!info.id) return stale
  return stale || !info.slug || !info.boxArtUrl
}

const sameInfo = (a: KnownGame | undefined, b: KnownGame): boolean =>
  a !== undefined &&
  (b.id ?? a.id) === a.id &&
  (b.slug ?? a.slug) === a.slug &&
  (b.boxArtUrl ?? a.boxArtUrl) === a.boxArtUrl

export function createGameInfoService(deps: {
  gql: GqlClient
  games: Games
  clock: Clock
  logger: Logger
}): GameInfoService {
  const { gql, games, clock, logger } = deps
  const listeners = new Set<() => void>()
  let saved = games.all()
  let view: Record<string, KnownGame> | undefined
  let running: Promise<void> | undefined

  const changed = (): void => {
    saved = games.all()
    view = undefined
    for (const listener of listeners) listener()
  }

  const lookUp = async (names: readonly string[]): Promise<void> => {
    const results = await gql.batch(
      operations.GameByName,
      names.map((name) => ({ name }))
    )
    const found = names.map((name, i) => {
      const game = results[i]?.game
      if (!game) return { name }
      return {
        name,
        id: game.id,
        ...(game.slug ? { slug: game.slug } : {}),
        ...(game.boxArtURL ? { boxArtUrl: withoutImageSize(game.boxArtURL) } : {})
      }
    })
    games.save(found, clock.now())
    logger.debug('Looked up games', {
      asked: names.length,
      found: found.filter((g) => 'id' in g).length
    })
    changed()
  }

  return {
    fromCampaigns(campaigns): void {
      const byName = new Map<string, KnownGame & { name: string }>()
      for (const c of campaigns) {
        byName.set(c.game.name, {
          name: c.game.name,
          id: c.game.id,
          ...(c.game.slug ? { slug: c.game.slug } : {}),
          ...(c.game.boxArtUrl ? { boxArtUrl: c.game.boxArtUrl } : {})
        })
      }
      const fresh = [...byName.values()].filter((g) => !sameInfo(saved.get(g.name), g))
      if (fresh.length === 0) return
      games.save(fresh, clock.now())
      changed()
    },
    refresh(names): Promise<void> {
      // One round at a time; a round asked for meanwhile finds the rest next time.
      running ??= (async () => {
        const now = clock.now()
        const due = [...new Set(names)]
          .filter((name) => needsLookup(saved.get(name), now))
          .slice(0, LOOKUPS_PER_ROUND)
        if (due.length > 0) await lookUp(due)
      })()
        .catch((error: unknown) => logger.warn('Looking up games failed', { error }))
        .finally(() => (running = undefined))
      return running
    },
    known(): Readonly<Record<string, KnownGame>> {
      view ??= Object.fromEntries(
        [...saved.values()].map((g) => [
          g.name,
          {
            ...(g.id ? { id: g.id } : {}),
            ...(g.slug ? { slug: g.slug } : {}),
            ...(g.boxArtUrl ? { boxArtUrl: g.boxArtUrl } : {})
          }
        ])
      )
      return view
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
