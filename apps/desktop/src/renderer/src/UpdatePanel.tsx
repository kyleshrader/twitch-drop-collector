// Temporary update UI: the offer banner above every tab, and the status line in settings.
// Replaced in the UI redesign.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UpdateView } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'
import { invoke } from './ipc'
import { UPDATES_KEY, useUpdates } from './live'
import { strings } from './strings'

const t = strings.updates

type Action = 'updates:check' | 'updates:download' | 'updates:dismiss' | 'updates:skip'

function useUpdateAction(action: Action) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => invoke(action),
    onSuccess: (view) => {
      queryClient.setQueryData(UPDATES_KEY, view)
      // Skipping saves the version in settings.
      if (action === 'updates:skip') void queryClient.invalidateQueries({ queryKey: ['settings'] })
    }
  })
}

function describeUpdate(view: UpdateView): string {
  const version = view.version ?? ''
  switch (view.status) {
    case 'available':
      return view.error ? t.downloadFailed(view.error) : t.status.available(version)
    case 'downloading':
      return t.status.downloading(version, view.percent ?? 0)
    case 'ready':
      return t.status.ready(version)
    case 'error':
      return t.status.error(view.error ?? '')
    default:
      return t.status[view.status]
  }
}

/** Shown while an update is on offer, downloading or ready, unless the user chose Later. */
export function UpdateBanner(): ReactNode {
  const view = useUpdates()
  const download = useUpdateAction('updates:download')
  const dismiss = useUpdateAction('updates:dismiss')
  const skip = useUpdateAction('updates:skip')
  if (!view || view.dismissed) return null
  if (!['available', 'downloading', 'ready'].includes(view.status)) return null
  return (
    <section
      role="status"
      aria-label={strings.settings.updates.heading}
      data-testid="update-banner"
    >
      <p>{describeUpdate(view)}</p>
      {view.status === 'available' && (
        <button type="button" onClick={() => download.mutate()}>
          {t.updateNow}
        </button>
      )}
      {view.status === 'ready' && (
        <button type="button" onClick={() => void invoke('updates:install')}>
          {t.restartNow}
        </button>
      )}
      <button type="button" onClick={() => dismiss.mutate()}>
        {t.later}
      </button>
      {view.status !== 'downloading' && !view.skipped && (
        <button type="button" onClick={() => skip.mutate()}>
          {t.skip}
        </button>
      )}
    </section>
  )
}

/** Version, update status and Check for updates, for the settings screen. */
export function UpdateStatus(): ReactNode {
  const view = useUpdates()
  const check = useUpdateAction('updates:check')
  if (!view) return null
  const busy = check.isPending || view.status === 'checking'
  return (
    <div data-testid="update-status">
      <p>
        {t.current(view.currentVersion)} {describeUpdate(view)}
        {view.lastChecked !== undefined &&
          ` ${t.lastChecked(new Date(view.lastChecked).toLocaleString())}`}
      </p>
      {view.status !== 'unsupported' && (
        <button type="button" disabled={busy} onClick={() => check.mutate()}>
          {busy ? strings.settings.updates.checking : strings.settings.updates.check}
        </button>
      )}
    </div>
  )
}
