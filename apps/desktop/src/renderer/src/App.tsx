import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AppShell } from '@tdc/ui'
import { AccountPanel } from './AccountPanel'
import { InventoryScreen } from './InventoryScreen'
import { MiningPanel } from './MiningPanel'
import { invoke } from './ipc'
import { SettingsScreen } from './SettingsScreen'
import { strings } from './strings'
import { UpdateBanner } from './UpdatePanel'

const DROPS_INVENTORY_URL = 'https://www.twitch.tv/drops/inventory'

type Tab = keyof typeof strings.tabs

function MainScreen(): ReactNode {
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => invoke('app:getInfo') })
  const openExternal = useMutation({
    mutationFn: (url: string) => invoke('shell:openExternal', { url })
  })
  return (
    <>
      <AccountPanel />
      <MiningPanel />
      <p data-testid="app-version">
        {info.data
          ? strings.main.version(info.data.version, info.data.platform)
          : strings.main.loading}
      </p>
      <button type="button" onClick={() => openExternal.mutate(DROPS_INVENTORY_URL)}>
        {strings.main.openInventory}
      </button>
    </>
  )
}

function App(): ReactNode {
  // Plain tab state for the temporary UI; routing is chosen in the UI redesign.
  const [tab, setTab] = useState<Tab>('main')
  return (
    <AppShell title={strings.appTitle}>
      <UpdateBanner />
      <nav role="tablist">
        {(Object.keys(strings.tabs) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {strings.tabs[key]}
          </button>
        ))}
      </nav>
      {tab === 'main' ? (
        <MainScreen />
      ) : tab === 'inventory' ? (
        <InventoryScreen />
      ) : (
        <SettingsScreen />
      )}
    </AppShell>
  )
}

export default App
