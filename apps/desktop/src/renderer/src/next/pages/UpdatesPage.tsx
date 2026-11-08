// App updates: its own page, apart from notifications (ui-design.md).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UpdateView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from '../../ipc'
import { UPDATES_KEY } from '../../live'
import { icons } from '../icons'
import { strings } from '../strings'
import ui from '../ui.module.css'
import styles from './Pages.module.css'

const t = strings.updates
const Icon = icons
const { page, lead, panel, updateBox, updateIcon, actions } = styles
const { btn, green, ghost, grow, muted } = ui

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const ago = (ms: number): string => {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  return Math.abs(minutes) < 60
    ? RELATIVE.format(minutes, 'minute')
    : RELATIVE.format(Math.round(minutes / 60), 'hour')
}

export function UpdatesPage(props: { updates: UpdateView | undefined }): ReactNode {
  const { updates } = props
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: (channel: 'updates:check' | 'updates:download' | 'updates:skip') => invoke(channel),
    onSuccess: (view) => queryClient.setQueryData(UPDATES_KEY, view)
  })
  const install = useMutation({ mutationFn: () => invoke('updates:install') })
  if (!updates) return null
  const { status, version = '' } = updates

  const headline =
    status === 'available'
      ? t.available(version)
      : status === 'downloading'
        ? t.downloading(version, updates.percent ?? 0)
        : status === 'ready'
          ? t.ready(version)
          : status === 'checking'
            ? t.checking
            : status === 'unsupported'
              ? t.unsupported
              : status === 'error'
                ? t.error(updates.error ?? '')
                : t.upToDate

  return (
    <div className={page}>
      <h2>{t.heading}</h2>
      <p className={lead}>
        {t.version(updates.currentVersion)}{' '}
        {updates.lastChecked !== undefined && t.checked(ago(updates.lastChecked))}
      </p>
      <div className={panel}>
        <div className={updateBox}>
          <div className={updateIcon}>
            <Icon.update />
          </div>
          <div className={grow}>
            <b role="status">{headline}</b>
            {status === 'ready' && <div className={muted}>{t.readyNote}</div>}
            <div className={actions}>
              {status === 'ready' && (
                <button
                  type="button"
                  className={`${btn} ${green}`}
                  onClick={() => install.mutate()}
                >
                  {t.install}
                </button>
              )}
              {status === 'available' && (
                <button
                  type="button"
                  className={`${btn} ${green}`}
                  onClick={() => run.mutate('updates:download')}
                >
                  {t.download}
                </button>
              )}
              {(status === 'available' || status === 'ready') && !updates.skipped && (
                <button
                  type="button"
                  className={`${btn} ${ghost}`}
                  onClick={() => run.mutate('updates:skip')}
                >
                  {t.skip}
                </button>
              )}
              {status !== 'unsupported' && status !== 'checking' && status !== 'downloading' && (
                <button type="button" className={btn} onClick={() => run.mutate('updates:check')}>
                  {t.check}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
