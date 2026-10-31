// Temporary settings screen: every setting, no styling. Replaced in the UI redesign.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IpcError, type SettingsView } from '@tdc/ipc-contract'
import { useState, type ReactNode } from 'react'
import { invoke } from './ipc'
import { strings } from './strings'

const SETTINGS_KEY = ['settings'] as const
const t = strings.settings

const toLines = (values: readonly string[]): string => values.join('\n')
const fromLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

function SettingsForm({ initial }: { initial: SettingsView }): ReactNode {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(initial)
  const [priority, setPriority] = useState(toLines(initial.mining.priority))
  const [exclude, setExclude] = useState(toLines(initial.mining.exclude))

  const save = useMutation({
    mutationFn: () =>
      invoke('settings:update', {
        ...draft,
        mining: { ...draft.mining, priority: fromLines(priority), exclude: fromLines(exclude) }
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved)
      setDraft(saved)
    }
  })

  const set = <S extends keyof SettingsView>(section: S, values: Partial<SettingsView[S]>): void =>
    setDraft((current) => ({ ...current, [section]: { ...current[section], ...values } }))

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <fieldset>
        <legend>{t.general.heading}</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.general.launchAtLogin}
            onChange={(e) => set('general', { launchAtLogin: e.target.checked })}
          />
          {t.general.launchAtLogin}
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.general.startMinimized}
            onChange={(e) => set('general', { startMinimized: e.target.checked })}
          />
          {t.general.startMinimized}
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.general.closeToTray}
            onChange={(e) => set('general', { closeToTray: e.target.checked })}
          />
          {t.general.closeToTray}
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.general.trayNotifications}
            onChange={(e) => set('general', { trayNotifications: e.target.checked })}
          />
          {t.general.trayNotifications}
        </label>
        <label>
          {t.general.theme}
          <select
            value={draft.general.theme}
            onChange={(e) =>
              set('general', { theme: e.target.value as SettingsView['general']['theme'] })
            }
          >
            {Object.entries(t.general.themes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>{t.mining.heading}</legend>
        <label>
          {t.mining.priority}
          <textarea rows={5} value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
        <label>
          {t.mining.exclude}
          <textarea rows={3} value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </label>
        <label>
          {t.mining.priorityMode}
          <select
            value={draft.mining.priorityMode}
            onChange={(e) =>
              set('mining', {
                priorityMode: e.target.value as SettingsView['mining']['priorityMode']
              })
            }
          >
            {Object.entries(t.mining.priorityModes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.mining.enableBadgesEmotes}
            onChange={(e) => set('mining', { enableBadgesEmotes: e.target.checked })}
          />
          {t.mining.enableBadgesEmotes}
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.mining.availableDropsCheck}
            onChange={(e) => set('mining', { availableDropsCheck: e.target.checked })}
          />
          {t.mining.availableDropsCheck}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t.network.heading}</legend>
        <label>
          {t.network.proxy}
          <input
            type="text"
            value={draft.network.proxy}
            onChange={(e) => set('network', { proxy: e.target.value.trim() })}
          />
        </label>
        <label>
          {t.network.connectionQuality}
          <input
            type="number"
            min={1}
            max={6}
            value={draft.network.connectionQuality}
            onChange={(e) => set('network', { connectionQuality: e.target.valueAsNumber })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>{t.logging.heading}</legend>
        <label>
          {t.logging.level}
          <select
            value={draft.logging.level}
            onChange={(e) =>
              set('logging', { level: e.target.value as SettingsView['logging']['level'] })
            }
          >
            {Object.entries(t.logging.levels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <button type="submit" disabled={save.isPending}>
        {save.isPending ? t.saving : t.save}
      </button>
      <p role="status">
        {save.isSuccess && t.saved}
        {save.isError && t.saveFailed}
      </p>
      {save.error instanceof IpcError && save.error.issues.length > 0 && (
        <ul role="alert">
          {save.error.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </form>
  )
}

export function SettingsScreen(): ReactNode {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => invoke('settings:get') })
  if (!settings.data) return <p>{strings.main.loading}</p>
  return <SettingsForm initial={settings.data} />
}
