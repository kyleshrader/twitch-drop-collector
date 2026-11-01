// The new UI, in preview: built here screen by screen while the classic UI stays available.
// It reads the same live state and calls the same IPC as the classic UI; only the view differs.
// Styles are CSS modules, so nothing here leaks into the classic UI or the other way round.
import type { ReactNode } from 'react'
import { useAuthState, useMiner } from '../live'
import { useUiChoice } from '../ui-choice'
import styles from './NextApp.module.css'
import { strings as t } from './strings'

// Destructured: the strict TS config doesn't allow dot access on a CSS module's class map.
const { app, header, title, badge, back, main } = styles

export function NextApp(): ReactNode {
  const auth = useAuthState()
  const miner = useMiner()
  const { switchTo, switching, failed } = useUiChoice()

  return (
    <div className={app} data-testid="next-ui">
      <header className={header}>
        <h1 className={title}>{t.title}</h1>
        <span className={badge}>{t.preview}</span>
        <button
          type="button"
          className={back}
          disabled={switching}
          onClick={() => switchTo('classic')}
        >
          {switching ? t.switching : t.backToClassic}
        </button>
      </header>
      {failed && <p role="alert">{t.switchFailed}</p>}
      <main className={main}>
        <p>{t.intro}</p>
        <p role="status">
          {auth?.status === 'signedIn' ? t.status.signedIn(auth.user.login) : t.status.signedOut}
          {miner && <> · {t.miner(miner.status)}</>}
        </p>
      </main>
    </div>
  )
}
