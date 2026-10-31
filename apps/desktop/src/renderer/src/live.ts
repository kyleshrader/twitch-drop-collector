// State that main pushes: loaded once over IPC, then kept current by main → renderer events.
import { useQuery, type QueryClient } from '@tanstack/react-query'
import type {
  AuthStateView,
  EventChannel,
  EventPayload,
  MinerView,
  UpdateView
} from '@tdc/ipc-contract'
import { invoke } from './ipc'

export const MINER_KEY = ['miner'] as const
export const AUTH_KEY = ['auth'] as const
export const UPDATES_KEY = ['updates'] as const

const LIVE: { [E in EventChannel]: readonly string[] } = {
  'miner:state': MINER_KEY,
  'auth:state': AUTH_KEY,
  'updates:state': UPDATES_KEY
}

/**
 * Keeps the cached state current for the window's whole life. Subscribing per screen would miss
 * whatever changes while that screen isn't shown (the data never goes stale to be loaded again).
 */
export function followLiveState(queryClient: QueryClient): () => void {
  const offs = (Object.keys(LIVE) as EventChannel[]).map((event) =>
    window.api.on(event, (payload) => queryClient.setQueryData(LIVE[event], payload))
  )
  return () => offs.forEach((off) => off())
}

function useLive<E extends EventChannel>(
  event: E,
  load: () => Promise<EventPayload<E>>
): EventPayload<E> | undefined {
  return useQuery({ queryKey: LIVE[event], queryFn: load, staleTime: Number.POSITIVE_INFINITY })
    .data
}

export const useMiner = (): MinerView | undefined =>
  useLive('miner:state', () => invoke('miner:getState'))

export const useAuthState = (): AuthStateView | undefined =>
  useLive('auth:state', () => invoke('auth:getState'))

export const useUpdates = (): UpdateView | undefined =>
  useLive('updates:state', () => invoke('updates:getState'))
