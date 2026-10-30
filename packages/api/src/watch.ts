// "Watching" a stream the way Twitch counts it for drops: request the live HLS playlist and send
// HEAD requests for its segments, without downloading any video.
import type { Logger } from '@tdc/kernel'
import type { GqlClient } from './gql/client'
import { PlaybackAccessToken } from './gql/operations'
import type { HttpClient } from './http'

export interface StreamWatcher {
  /** One watch tick (the miner sends one about every 20s). True if Twitch served the stream. */
  watch(login: string, signal?: AbortSignal): Promise<boolean>
  /** Drops the cached playlist URL, e.g. after the stream restarted. */
  forget(login: string): void
}

/** Usher answers with JSON instead of a playlist when something is wrong (offline, banned…). */
function jsonError(text: string): string | undefined {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: unknown } | undefined
    return String(first?.error ?? 'unexpected JSON response')
  } catch {
    return undefined
  }
}

/** Absolute URLs of the entries in an m3u8 playlist (lines that aren't tags or blank). */
export function playlistEntries(text: string, base: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .flatMap((line) => {
      try {
        return [new URL(line, base).toString()]
      } catch {
        return []
      }
    })
}

export function createHlsWatcher(deps: {
  http: HttpClient
  gql: GqlClient
  usherUrl: string
  logger: Logger
}): StreamWatcher {
  const { http, gql, usherUrl, logger } = deps
  const variants = new Map<string, string>()

  const resolveVariant = async (
    login: string,
    signal?: AbortSignal
  ): Promise<string | undefined> => {
    const cached = variants.get(login)
    if (cached) return cached
    const { streamPlaybackAccessToken: token } = await gql.request(
      PlaybackAccessToken,
      { login },
      signal
    )
    if (!token) return undefined
    const master = new URL(`/api/channel/hls/${encodeURIComponent(login)}.m3u8`, usherUrl)
    master.searchParams.set('sig', token.signature)
    master.searchParams.set('token', token.value)
    const response = await http.request({ method: 'GET', url: master.toString(), signal })
    const error = response.status === 200 ? jsonError(response.text) : `HTTP ${response.status}`
    if (error !== undefined) {
      logger.info('No playlist for channel', { login, error })
      return undefined
    }
    // Twitch lists variants best-first; the last is the cheapest to "watch".
    const variant = playlistEntries(response.text, master.toString()).at(-1)
    if (variant) variants.set(login, variant)
    return variant
  }

  return {
    async watch(login, signal) {
      const variant = await resolveVariant(login, signal)
      if (!variant) return false

      const playlist = await http.request({ method: 'GET', url: variant, signal })
      const error = playlist.status === 200 ? jsonError(playlist.text) : `HTTP ${playlist.status}`
      if (error !== undefined) {
        // Offline or the stream restarted; resolve a fresh playlist next time.
        variants.delete(login)
        logger.info('Watch failed', { login, error })
        return false
      }
      const segments = playlistEntries(playlist.text, variant)
      if (segments.length === 0) return false
      for (const segment of segments) {
        const head = await http.request({ method: 'HEAD', url: segment, signal })
        if (head.status !== 200) return false
      }
      return true
    },
    forget(login) {
      variants.delete(login)
    }
  }
}
