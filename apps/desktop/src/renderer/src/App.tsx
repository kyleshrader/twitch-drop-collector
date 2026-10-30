import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AppShell } from '@tdc/ui'
import { invoke } from './ipc'

const DROPS_INVENTORY_URL = 'https://www.twitch.tv/drops/inventory'

function App(): ReactNode {
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => invoke('app:getInfo') })
  const openExternal = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })

  return (
    <AppShell title="Twitch Drop Collector">
      <p data-testid="app-version">
        {info.data ? `Version ${info.data.version} (${info.data.platform})` : 'Loading…'}
      </p>
      <button type="button" onClick={() => openExternal.mutate(DROPS_INVENTORY_URL)}>
        Open Twitch drops inventory
      </button>
    </AppShell>
  )
}

export default App
