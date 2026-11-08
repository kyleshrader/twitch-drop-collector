// Searching Twitch's games (categories), so a game without drops can be put on a list too.
import { z } from 'zod'

export const SearchGamesInput = z.object({ query: z.string().trim().min(1).max(100) })
export type SearchGamesInput = z.infer<typeof SearchGamesInput>

export const GameSearchResult = z.object({
  id: z.string(),
  /** The name lists use, as in campaigns. */
  name: z.string(),
  boxArtUrl: z.string().optional(),
  /** The game's address on Twitch: twitch.tv/directory/category/<slug>. */
  slug: z.string().optional()
})
export type GameSearchResult = z.infer<typeof GameSearchResult>
