// The new UI (docs/new-ui/ui-design.md), in preview beside the classic UI. It reads the same live
// state and calls the same IPC; only the view differs. Styles are CSS modules, so nothing here
// leaks into the classic UI or the other way round.
import '@fontsource-variable/inter'
import type { ReactNode } from 'react'
import { useApiIssues, useAuthState, useMiner, useSettings, useUpdates } from '../live'
import { useMiddleClickScroll } from './autoscroll'
import { useKeyboard } from './keyboard'
import { useNow } from './data'
import { DropsPage } from './drops/DropsPage'
import { HistoryPage } from './pages/HistoryPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { SignedOut } from './pages/SignedOut'
import { TwitchApiPage } from './pages/TwitchApiPage'
import { UpdatesPage } from './pages/UpdatesPage'
import { useHistoryKeys, useRoute, type Route } from './router'
import { strings } from './strings'
import { TopBar } from './TopBar'
import ui from './ui.module.css'

const { app, main, autoscrollMarker } = ui

export function NextApp(): ReactNode {
  const auth = useAuthState()
  const miner = useMiner()
  const settings = useSettings()
  const updates = useUpdates()
  const apiIssues = useApiIssues()
  const route = useRoute()
  const now = useNow()
  useHistoryKeys()
  useKeyboard()
  useMiddleClickScroll(autoscrollMarker)

  const signedIn = auth?.status === 'signedIn'
  const page = (r: Route): ReactNode => {
    if (!settings) return null
    if (r.page === 'settings') return <SettingsPage settings={settings} />
    if (r.page === 'updates') return <UpdatesPage updates={updates} />
    if (r.page === 'twitchApi') {
      return <TwitchApiPage issues={apiIssues} settings={settings} issueId={r.issueId} />
    }
    if (!signedIn) return <SignedOut auth={auth} />
    if (r.page === 'history') return <HistoryPage miner={miner} now={now} />
    if (r.page === 'library') {
      return (
        <LibraryPage
          campaigns={miner?.campaigns ?? []}
          seenByGame={miner?.seenByGame}
          games={miner?.games}
          gameId={r.gameId}
          group={r.group}
        />
      )
    }
    return (
      <DropsPage
        miner={miner}
        settings={settings}
        target={r.page === 'drops' ? r.target : undefined}
      />
    )
  }

  return (
    <div className={app} data-testid="next-ui" data-theme={settings?.general.theme ?? 'system'}>
      <TopBar
        route={route}
        auth={auth}
        miner={miner}
        updates={updates}
        apiIssues={apiIssues}
        now={now}
      />
      <main className={main} aria-label={strings.title}>
        {page(route)}
      </main>
    </div>
  )
}
