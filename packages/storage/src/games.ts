// What the app knows about games, by name: Twitch's ID, the address of the game's page
// (twitch.tv/directory/category/<slug>) and its box art. Campaigns bring this for their games;
// for games without campaigns (on a list, found by a search) the app looks it up. Each row says
// when it was last checked, so the app can refresh it over time.
import type { Database } from './database'

export interface GameInfo {
  name: string
  id?: string
  slug?: string
  boxArtUrl?: string
  checkedAt: Date
}

export interface Games {
  /**
   * Saves what's known about games, as checked `at`. A field that's missing keeps its saved
   * value, so a source that doesn't know the slug doesn't erase one.
   */
  save(games: readonly Omit<GameInfo, 'checkedAt'>[], at: Date): void
  /** Everything known, by name. */
  all(): Map<string, GameInfo>
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

export function createGames(deps: { db: Database }): Games {
  const { db } = deps
  return {
    save(games, at): void {
      db.transaction(() => {
        for (const g of games) {
          db.run(
            `INSERT INTO games (name, game_id, slug, box_art_url, checked_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (name) DO UPDATE SET
               game_id     = COALESCE(excluded.game_id, game_id),
               slug        = COALESCE(excluded.slug, slug),
               box_art_url = COALESCE(excluded.box_art_url, box_art_url),
               checked_at  = excluded.checked_at`,
            g.name,
            g.id ?? null,
            g.slug ?? null,
            g.boxArtUrl ?? null,
            at.getTime()
          )
        }
      })
    },
    all(): Map<string, GameInfo> {
      return new Map(
        db.all('SELECT name, game_id, slug, box_art_url, checked_at FROM games').map((row) => {
          const id = text(row['game_id'])
          const slug = text(row['slug'])
          const boxArtUrl = text(row['box_art_url'])
          const name = String(row['name'])
          return [
            name,
            {
              name,
              ...(id ? { id } : {}),
              ...(slug ? { slug } : {}),
              ...(boxArtUrl ? { boxArtUrl } : {}),
              checkedAt: new Date(Number(row['checked_at']))
            }
          ]
        })
      )
    }
  }
}
