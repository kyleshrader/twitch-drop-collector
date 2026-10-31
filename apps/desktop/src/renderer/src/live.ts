// State that main pushes: loaded once over IPC, then kept current by main → renderer events.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthStateView, EventChannel, EventPayload, MinerView } from '@tdc/ipc-contract'
import { useEffect } from 'react'
import { invoke } from './ipc'

function useLive<E extends EventChannel>(
  event: E,
  key: readonly string[],
  load: () => Promise<EventPayload<E>>
): EventPayload<E> | undefined {
  const queryClient = useQueryClient()
  useEffect(
    () => window.api.on(event, (payload) => queryClient.setQueryData(key, payload)),
    [event, key, queryClient]
  )
  return useQuery({ queryKey: key, queryFn: load, staleTime: Number.POSITIVE_INFINITY }).data
}

export const MINER_KEY = ['miner'] as const
export const AUTH_KEY = ['auth'] as const

export const useMiner = (): MinerView | undefined =>
  useLive('miner:state', MINER_KEY, () => invoke('miner:getState'))

export const useAuthState = (): AuthStateView | undefined =>
  useLive('auth:state', AUTH_KEY, () => invoke('auth:getState'))
