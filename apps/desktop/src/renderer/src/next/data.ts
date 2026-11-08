// The new UI's changes: everything goes through settings:update (main validates and stores it,
// then pushes the new miner view) or the existing miner and shell calls.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GameSearchResult, SettingsPatchInput, SettingsView } from '@tdc/ipc-contract'
import { useEffect, useState } from 'react'
import { invoke } from '../ipc'
import { SETTINGS_KEY, useSettings } from '../live'

export type ListChoice = 'priority' | 'notSet' | 'excluded'

/** Saves a settings patch and puts what main saved in the cache. */
export function useSettingsPatch(): {
  save: (patch: SettingsPatchInput) => void
  saving: boolean
  failed: boolean
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (patch: SettingsPatchInput) => invoke('settings:update', patch),
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved)
  })
  return { save: mutation.mutate, saving: mutation.isPending, failed: mutation.isError }
}

export function listOf(settings: SettingsView | undefined, game: string): ListChoice {
  if (settings?.mining.exclude.includes(game)) return 'excluded'
  return settings?.mining.priority.includes(game) ? 'priority' : 'notSet'
}

/** Puts a game on the priority list (at the end), the excluded list, or neither. */
export function listPatch(
  settings: SettingsView,
  game: string,
  choice: ListChoice
): SettingsPatchInput {
  const priority = settings.mining.priority.filter((g) => g !== game)
  const exclude = settings.mining.exclude.filter((g) => g !== game)
  if (choice === 'priority') priority.push(game)
  if (choice === 'excluded') exclude.push(game)
  return { mining: { priority, exclude } }
}

export function useGameList(): {
  listOf: (game: string) => ListChoice
  setList: (game: string, choice: ListChoice) => void
} {
  const settings = useSettings()
  const { save } = useSettingsPatch()
  return {
    listOf: (game) => listOf(settings, game),
    setList: (game, choice) => {
      if (settings) save(listPatch(settings, game, choice))
    }
  }
}

/** A new Up next order: switches the sort to Custom, remembering the automatic sort it left. */
export function customOrderPatch(
  settings: SettingsView,
  order: readonly string[]
): SettingsPatchInput {
  const { sort, baseSort } = settings.queue
  return {
    queue: { sort: 'custom', baseSort: sort === 'custom' ? baseSort : sort, order: [...order] }
  }
}

export function useOpenExternal(): (url: string) => void {
  const open = useMutation({ mutationFn: (url: string) => invoke('shell:openExternal', { url }) })
  return open.mutate
}

/** The time now, refreshed every `everyMs` (countdowns and "ends in"). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [everyMs])
  return now
}

/** Per-device UI memory (hidden Completed entries): browser storage, which may be unavailable. */
export function useLocalSet(key: string): {
  has: (id: string) => boolean
  add: (ids: readonly string[]) => void
  clear: () => void
  size: number
} {
  const [items, setItems] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const store = (next: ReadonlySet<string>): void => {
    setItems(next)
    try {
      window.localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      // Not remembered across restarts; still hidden for now.
    }
  }
  return {
    has: (id) => items.has(id),
    add: (ids) => store(new Set([...items, ...ids])),
    clear: () => store(new Set()),
    size: items.size
  }
}

/** A per-device on/off memory (a collapsed section): browser storage, which may be unavailable. */
export function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const store = (next: boolean): void => {
    setOn(next)
    try {
      if (next) window.localStorage.setItem(key, '1')
      else window.localStorage.removeItem(key)
    } catch {
      // Remembered until the window closes.
    }
  }
  return [on, store]
}

/** Shortest search that asks Twitch; one letter matches too much to be useful. */
export const MIN_SEARCH = 2
const SEARCH_DELAY_MS = 300

/**
 * What searches found about games (box art, address), by name: a game put on a list from a search
 * keeps them until the app restarts (lists hold names only).
 */
const searched = new Map<string, { boxArtUrl?: string; slug?: string }>()
export const searchedGames: ReadonlyMap<string, { boxArtUrl?: string; slug?: string }> = searched

/** Twitch games matching `query`, asked once typing pauses. Empty for short queries. */
export function useGameSearch(query: string): {
  results: readonly GameSearchResult[]
  searching: boolean
  failed: boolean
} {
  const q = query.trim()
  const [settled, setSettled] = useState(q)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(q), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [q])
  const enabled = settled.length >= MIN_SEARCH
  const search = useQuery({
    queryKey: ['games:search', settled.toLowerCase()],
    queryFn: async () => {
      const results = await invoke('games:search', { query: settled })
      for (const { name, ...known } of results) searched.set(name, known)
      return results
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false
  })
  if (q.length < MIN_SEARCH) return { results: [], searching: false, failed: false }
  return {
    results: (enabled && search.data) || [],
    searching: q !== settled || search.isFetching,
    failed: search.isError
  }
}
