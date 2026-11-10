// The History page's timeline (docs/new-ui/history.md): claims, watch sessions, new campaigns and
// how ended campaigns went, from the local database. Pure: records and the time go in.
import type { HistoryEntryView, HistoryView } from '@tdc/ipc-contract'
import type { AppEvent, ClaimRecord, SeenRecord, WatchSession } from '@tdc/storage'

/** At most this many entries go to the page (newest first); older ones are left out. */
export const MAX_ENTRIES = 5000
const MINUTE = 60_000

export function buildHistory(input: {
  claims: readonly ClaimRecord[]
  seen: readonly SeenRecord[]
  sessions: readonly WatchSession[]
  /** The event log (list changes, links, pauses, app versions); none before migration 6. */
  events?: readonly AppEvent[]
  now: Date
}): HistoryView {
  const { claims, seen, sessions, now, events = [] } = input
  const names = new Map(seen.map((s) => [s.id, s.name]))
  const entries: HistoryEntryView[] = []

  for (const c of claims) {
    const campaign = names.get(c.campaignId)
    entries.push({
      kind: 'claim',
      id: `claim:${c.dropId}`,
      at: c.claimedAt.toISOString(),
      game: c.gameName,
      campaignId: c.campaignId,
      ...(campaign ? { campaign } : {}),
      drop: c.dropName,
      rewards: c.rewards,
      ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
      ...(c.source === 'twitch' ? { fromTwitch: true } : {})
    })
  }

  const watchedBy = new Map<string, number>()
  for (const s of sessions) {
    const minutes = (s.endedAt.getTime() - s.startedAt.getTime()) / MINUTE
    if (s.campaignId) watchedBy.set(s.campaignId, (watchedBy.get(s.campaignId) ?? 0) + minutes)
    entries.push({
      kind: 'watch',
      id: `watch:${s.id}`,
      at: s.startedAt.toISOString(),
      endedAt: s.endedAt.toISOString(),
      minutes,
      game: s.gameName,
      channelLogin: s.channelLogin,
      channelName: s.channelName,
      ...(s.campaignId ? { campaignId: s.campaignId } : {}),
      ...(s.campaignName ? { campaign: s.campaignName } : {})
    })
  }

  // Ended campaigns, by how they stood when last seen (and any claims recorded since).
  const claimedBy = new Map<string, number>()
  for (const c of claims) claimedBy.set(c.campaignId, (claimedBy.get(c.campaignId) ?? 0) + 1)
  for (const s of seen) {
    const standing = s.standing
    if (!standing || standing.endsAt > now || standing.dropsTotal === 0) continue
    const total = standing.dropsTotal
    const claimed = Math.min(total, Math.max(standing.dropsClaimed, claimedBy.get(s.id) ?? 0))
    entries.push({
      kind: 'ended',
      id: `ended:${s.id}`,
      at: standing.endsAt.toISOString(),
      game: s.gameName,
      campaignId: s.id,
      campaign: s.name,
      claimed,
      total,
      outcome:
        claimed >= total
          ? 'completed'
          : claimed > 0
            ? 'partial'
            : standing.earnable
              ? 'missed'
              : 'notEarnable',
      watchedMinutes: watchedBy.get(s.id) ?? 0
    })
  }

  // New campaigns, one entry per game for each load that found some. The first load's are the
  // campaigns already running when the history started: counted, not listed. A game's very first
  // campaigns (after that first load) are a new game in the Library.
  const firstLoad = seen.reduce<number | undefined>(
    (first, s) => Math.min(first ?? Infinity, s.firstSeenAt.getTime()),
    undefined
  )
  const found = new Map<
    string,
    { at: Date; game: string; isNewGame: boolean; campaigns: SeenRecord[] }
  >()
  let runningAtStart = 0
  const gameFirstSeen = new Map<string, number>()
  for (const s of seen) {
    const was = gameFirstSeen.get(s.gameId)
    if (was === undefined || s.firstSeenAt.getTime() < was) {
      gameFirstSeen.set(s.gameId, s.firstSeenAt.getTime())
    }
  }
  for (const s of seen) {
    // Seen while upcoming, and started since: worth a line of its own.
    const standing = s.standing
    if (standing && standing.startsAt > s.firstSeenAt && standing.startsAt <= now) {
      entries.push({
        kind: 'started',
        id: `started:${s.id}`,
        at: standing.startsAt.toISOString(),
        game: s.gameName,
        campaignId: s.id,
        campaign: s.name
      })
    }
    if (s.firstSeenAt.getTime() === firstLoad) {
      runningAtStart += 1
      continue
    }
    const key = `${s.gameName}\n${s.firstSeenAt.getTime()}`
    const group = found.get(key) ?? {
      at: s.firstSeenAt,
      game: s.gameName,
      isNewGame: gameFirstSeen.get(s.gameId) === s.firstSeenAt.getTime(),
      campaigns: []
    }
    group.campaigns.push(s)
    found.set(key, group)
  }
  for (const group of found.values()) {
    entries.push({
      kind: group.isNewGame ? 'newGame' : 'new',
      id: `new:${group.at.getTime()}:${group.campaigns[0]!.id}`,
      at: group.at.toISOString(),
      game: group.game,
      campaigns: group.campaigns.map((c) => ({ id: c.id, name: c.name }))
    })
  }

  // The event log. App versions become "updated" entries from the second version on.
  let version: string | undefined
  for (const e of events) {
    const id = `event:${e.id}`
    const at = e.at.toISOString()
    const text = (key: string): string | undefined =>
      typeof e.data[key] === 'string' ? e.data[key] : undefined
    const game = text('game')
    if (e.kind === 'list' && game) {
      const list = text('list')
      if (list === 'priority' || list === 'excluded' || list === 'notSet') {
        entries.push({ kind: 'list', id, at, game, list })
      }
    } else if (e.kind === 'linked' && game) {
      entries.push({ kind: 'linked', id, at, game })
    } else if (e.kind === 'paused' || e.kind === 'resumed') {
      entries.push({ kind: 'app', id, at, event: e.kind })
    } else if (e.kind === 'version') {
      const next = text('version')
      if (next && version && next !== version) {
        entries.push({ kind: 'app', id, at, event: 'updated', version: next, from: version })
      }
      version = next ?? version
    }
  }

  entries.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  const starts = [
    firstLoad,
    ...claims.map((c) => c.claimedAt.getTime()),
    ...sessions.map((s) => s.startedAt.getTime())
  ].filter((t): t is number => t !== undefined)
  return {
    ...(starts.length > 0 ? { startedAt: new Date(Math.min(...starts)).toISOString() } : {}),
    runningAtStart,
    entries: entries.slice(0, MAX_ENTRIES)
  }
}
